// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function rejected(p: Promise<unknown>) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, 'expected the database to reject it').toBeTruthy();
  expect(String((err as Error).message)).toMatch(/Only Gmail addresses/);
}

describe('Gmail-only accounts (database rule)', () => {
  it('accepts Gmail sign-ups, case-insensitively, including dots and plus aliases', async () => {
    await t.createUser(uid(1), 'juan.dela.cruz@gmail.com');
    await t.createUser(uid(2), 'Maria+notes@GMAIL.com');
    await t.createUser(uid(3), 'x@gmail.com');
    const rows = await t.admin<{ n: number }>(`select count(*)::int as n from auth.users`);
    expect(rows[0].n).toBe(3);
  });

  it('rejects other domains and look-alikes', async () => {
    for (const [i, email] of [
      'juan@yahoo.com',
      'juan@gmail.co',
      'juan@gmail.com.ph',
      'juan@googlemail.com',
      'juan@mail.gmail.com',
      'juan@gmailcom',
    ].entries()) {
      await rejected(t.createUser(uid(100 + i), email));
    }
  });

  it('rejects malformed Gmail addresses', async () => {
    for (const [i, email] of [
      '.juan@gmail.com',
      'juan.@gmail.com',
      'ju..an@gmail.com',
      'ju an@gmail.com',
      'ju#an@gmail.com',
      '@gmail.com',
    ].entries()) {
      await rejected(t.createUser(uid(200 + i), email));
    }
  });

  it('blocks changing an account email to a non-Gmail address (direct or pending change)', async () => {
    await rejected(
      t.admin(`update auth.users set email = 'juan@outlook.com' where id = $1`, [uid(1)]),
    );
    await rejected(
      t.admin(`update auth.users set email_change = 'juan@outlook.com' where id = $1`, [uid(1)]),
    );
    await t.admin(`update auth.users set email_change = 'juan.new@gmail.com' where id = $1`, [
      uid(1),
    ]);
  });

  it('does not affect accounts without an email (e.g. phone sign-in)', async () => {
    await t.admin(`insert into auth.users (id, email) values ($1, null)`, [uid(300)]);
  });
});
