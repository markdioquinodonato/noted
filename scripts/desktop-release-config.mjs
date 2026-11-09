// Writes src-tauri/tauri.release.conf.json for CI builds: points the signed
// updater at this repository's GitHub Releases. Kept out of tauri.conf.json so
// local/dev builds never ship a guessed or unverified update endpoint.
import { writeFile } from 'node:fs/promises';

const repo = process.env.GITHUB_REPOSITORY;
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('GITHUB_REPOSITORY is not set (expected "owner/name").');
  process.exit(1);
}

const config = {
  plugins: {
    updater: {
      endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`],
    },
  },
};

await writeFile('src-tauri/tauri.release.conf.json', `${JSON.stringify(config, null, 2)}\n`);
console.log(`Updater endpoint: ${config.plugins.updater.endpoints[0]}`);
