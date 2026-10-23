import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run from the repository root after Vite completes. No timestamp: reproducible output.
const root = path.resolve('dist');
const { name: project } = JSON.parse(await readFile('package.json', 'utf8'));
const commit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
}).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Build requires a full source commit SHA.');
async function collect(dir) {
  const paths = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) paths.push(...await collect(file));
    else if (item.isFile() && item.name !== 'release-manifest.json') paths.push(file);
  }
  return paths;
}
const files = [];
for (const file of (await collect(root)).sort()) {
  const bytes = await readFile(file);
  files.push({path: path.relative(root, file).split(path.sep).join('/'), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(path.join(root, 'release-manifest.json'), JSON.stringify({
  schemaVersion: 1, project, commit, files,
}, null, 2) + '\n');
console.log(`Release manifest: ${project} ${commit}, ${files.length} files`);
