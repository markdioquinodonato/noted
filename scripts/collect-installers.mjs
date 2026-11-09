// Copies the installers produced by `tauri build --target <triple>` into an
// output folder with clear, platform-specific names. Fails if an expected
// installer is missing, so a broken build can never upload a partial set.
//
//   node scripts/collect-installers.mjs <target-triple> <out-dir>
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const [target, out = 'installers'] = process.argv.slice(2);
const bundle = join('src-tauri', 'target', target ?? '', 'release', 'bundle');

const plans = {
  'x86_64-pc-windows-msvc': [
    { dir: 'nsis', match: /-setup\.exe$/i, name: 'Noted-Setup-Windows-x64.exe' },
    { dir: 'msi', match: /\.msi$/i, name: 'Noted-Windows-x64.msi' },
  ],
  'aarch64-apple-darwin': [
    { dir: 'dmg', match: /\.dmg$/i, name: 'Noted-macOS-AppleSilicon.dmg' },
    { dir: 'macos', match: /\.app\.tar\.gz$/i, name: 'Noted-macOS-AppleSilicon.app.tar.gz' },
  ],
  'x86_64-apple-darwin': [
    { dir: 'dmg', match: /\.dmg$/i, name: 'Noted-macOS-Intel.dmg' },
    { dir: 'macos', match: /\.app\.tar\.gz$/i, name: 'Noted-macOS-Intel.app.tar.gz' },
  ],
};

const plan = plans[target];
if (!plan) {
  console.error(`Unknown target "${target}". Expected one of: ${Object.keys(plans).join(', ')}`);
  process.exit(1);
}

await mkdir(out, { recursive: true });
let failed = false;
for (const item of plan) {
  const dir = join(bundle, item.dir);
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => item.match.test(f));
  } catch {
    /* missing directory */
  }
  if (files.length !== 1) {
    console.error(`Expected exactly one ${item.match} in ${dir}, found ${files.length}.`);
    failed = true;
    continue;
  }
  const src = join(dir, files[0]);
  const size = (await stat(src)).size;
  if (!size) {
    console.error(`${src} is empty.`);
    failed = true;
    continue;
  }
  await copyFile(src, join(out, item.name));
  console.log(`${files[0]}  ->  ${item.name}  (${(size / 1048576).toFixed(1)} MB)`);
}
if (failed) process.exit(1);
