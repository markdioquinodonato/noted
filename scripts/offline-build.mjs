import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve('dist');
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else if (entry.name !== 'sw.js') result.push(path);
  }
  return result;
}
const files = await walk(root),
  hash = createHash('sha256');
for (const file of files) hash.update(await readFile(file));
const version = `noted-shell-${hash.digest('hex').slice(0, 16)}`;
const paths = files.map((file) => relative(root, file).replaceAll('\\', '/'));
await writeFile(
  join(root, 'sw.js'),
  `
const CACHE=${JSON.stringify(version)};
const URLS=${JSON.stringify(paths)}.map(path=>new URL(path,self.registration.scope).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(URLS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('noted-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(cache=>cache.match(new URL('index.html',self.registration.scope).href))));
  else if(URLS.includes(event.request.url))event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request.url,{ignoreVary:true}).then(cached=>cached||fetch(event.request))));
});
`,
);
