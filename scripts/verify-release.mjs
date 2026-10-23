import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [baseArg, expectedCommit] = process.argv.slice(2);
if (!baseArg || !/^[a-f0-9]{40}$/.test(expectedCommit ?? ''))
  throw new Error('Usage: node scripts/verify-release.mjs HTTPS_BASE_URL COMMIT_SHA');
const base = new URL(baseArg);
if (base.protocol !== 'https:' || !base.pathname.endsWith('/') || base.search || base.hash)
  throw new Error('Use an HTTPS project base URL ending in / without query or fragment.');
const { name: project } = JSON.parse(await readFile('package.json', 'utf8'));
const local = JSON.parse(await readFile('dist/release-manifest.json', 'utf8'));
if (local.schemaVersion !== 1 || local.project !== project || local.commit !== expectedCommit)
  throw new Error('Local manifest does not identify the expected project and source commit.');
if (!Array.isArray(local.files) || local.files.length < 3 || local.files.length > 100)
  throw new Error('Invalid local asset count.');
const paths = new Set();
for (const entry of local.files) {
  if (typeof entry.path !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(entry.path) ||
      entry.path.includes('..') || entry.path.startsWith('/') || paths.has(entry.path) ||
      !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256))
    throw new Error('Invalid local asset entry.');
  paths.add(entry.path);
  const bytes = await readFile(path.join('dist', entry.path));
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error(`Local asset changed after manifest generation: ${entry.path}`);
}
if (!paths.has('index.html')) throw new Error('Manifest omits the entry document.');
async function download(asset) {
  const url = new URL(asset, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
    throw new Error('Asset escaped project base.');
  url.searchParams.set('release', expectedCommit);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${asset}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const remote = JSON.parse((await download('release-manifest.json')).toString('utf8'));
if (remote.schemaVersion !== local.schemaVersion || remote.project !== project ||
    remote.commit !== expectedCommit || JSON.stringify(remote.files) !== JSON.stringify(local.files))
  throw new Error('Published manifest differs from the local build of the expected source.');
for (const entry of local.files) {
  const bytes = await download(entry.path);
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error(`Published asset differs from expected source: ${entry.path}`);
  console.log(`SHA-256 OK ${entry.path} (${bytes.length} bytes)`);
}
console.log(`VERIFIED ${project} ${expectedCommit}: ${local.files.length} exact asset matches`);
