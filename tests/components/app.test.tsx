import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes, createQueryClient } from '@/app/App';
import { plainText } from '@/lib/richText';
import { LocalNotesRepository } from '@/data/local/localRepository';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const qc = createQueryClient();
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, ...utils };
}

describe('Welcome & guest access', () => {
  it('offers Continue as Guest, Create Free Account and Login', async () => {
    renderAt('/');
    expect(await screen.findByRole('button', { name: /continue as guest/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create an account/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^log in$/i })).toBeInTheDocument();
  });

  it('lets a guest start writing without any account', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/welcome');
    await user.click(await screen.findByRole('button', { name: /continue as guest/i }));
    expect(router.state.location.pathname).toBe('/notes');
    expect(localStorage.getItem('noted:mode')).toBe('guest');
    expect(await screen.findByRole('button', { name: /^Write something…?$/i })).toBeInTheDocument();
    const profile = screen.getByRole('button', { name: 'Profile' });
    expect(profile).toHaveAttribute('title', expect.stringMatching(/saved only in this browser/i));
    await user.click(profile);
    expect(
      within(await screen.findByRole('menu')).getByText('Saved in this browser'),
    ).toBeVisible();
  });
});

describe('Guest notes workspace', () => {
  it('creates a note, autosaves it to IndexedDB, and shows it in the list with counters', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/notes');
    await user.click(await screen.findByRole('button', { name: /^Write something…?$/i }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/notes\/.+/));

    const title = await screen.findByRole('textbox', { name: /note title/i });
    await user.type(title, 'Shopping');
    const body = screen.getByRole('textbox', { name: /note content/i });
    body.innerHTML = '<p>Milk and eggs</p>';
    fireEvent.input(body);
    await waitFor(() => expect(body).toHaveTextContent('Milk and eggs'));
    await user.click(screen.getByRole('button', { name: 'More note actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Show note details' }));
    await waitFor(() => expect(screen.getByTestId('word-count')).toHaveTextContent('3 words'));

    expect(screen.getByTestId('word-count')).toHaveTextContent('3 words');
    expect(screen.getByTestId('char-count')).toHaveTextContent('13 characters');

    await waitFor(
      () => expect(screen.getAllByTestId('save-status')[0]).toHaveAttribute('data-status', 'saved'),
      { timeout: 4000 },
    );
    expect(screen.queryByRole('searchbox', { name: /search notes/i })).not.toBeInTheDocument();

    const id = router.state.location.pathname.split('/').pop()!;
    const stored = await new LocalNotesRepository().getNote(id);
    expect(stored?.title).toBe('Shopping');
    expect(plainText(stored!.content)).toBe('Milk and eggs');

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notes'));
    const list = await screen.findByTestId('note-list');
    await waitFor(() => expect(within(list).getByText('Shopping')).toBeVisible());
  });

  it('searches notes by content', async () => {
    const repo = new LocalNotesRepository();
    await repo.createNote({ title: 'Alpha', content: 'the quick brown fox' });
    await repo.createNote({ title: 'Beta', content: 'lazy dog' });
    const user = userEvent.setup();
    renderAt('/notes');
    const list = await screen.findByTestId('note-list');
    await waitFor(() => expect(within(list).getAllByTestId('note-row')).toHaveLength(2));
    await user.type(screen.getByRole('searchbox', { name: /search notes/i }), 'brown');
    await waitFor(() => expect(within(list).getAllByTestId('note-row')).toHaveLength(1));
    expect(within(list).getByText('Alpha')).toBeInTheDocument();
  });

  it('creating a folder via dialog, Escape closes dialogs', async () => {
    const user = userEvent.setup();
    renderAt('/notes');
    await user.click(await screen.findByRole('button', { name: 'Folders' }));
    await user.click(await screen.findByRole('button', { name: /new folder/i }));
    const dialog = await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /new folder/i }));
    await user.type(await screen.findByLabelText(/folder name/i), 'Projects{Enter}');
    await waitFor(() => expect(screen.getByTestId('list-heading')).toHaveTextContent('Projects'));
  });
});

describe('Protected routes & auth pages without cloud configuration', () => {
  it('redirects the account-only import page to login', async () => {
    const { router } = renderAt('/import');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toContain('next=%2Fimport');
    expect(await screen.findByText(/aren’t configured/i)).toBeInTheDocument();
  });

  it('shows the reset-password expired state without a recovery session', async () => {
    renderAt('/reset-password');
    expect(await screen.findByText(/link expired/i)).toBeInTheDocument();
  });

  it('renders a 404 page for unknown routes', async () => {
    renderAt('/nope');
    expect(await screen.findByText(/page not found/i)).toBeInTheDocument();
  });
});
