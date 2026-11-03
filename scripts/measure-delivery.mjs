// Raw file-byte inventory of the proposed submission, including dist and new non-ignored files.
// Excludes removed files; Git metadata, ignored dependencies and scratch checks are not payload.
import { execFileSync } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const names = [...new Set([
  ...execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean),
  '.imd-responses.json', // Required revision response, collected separately even if globally ignored.
])];
const groups = {};
let total = 0;
let files = 0;
for (const name of names) {
  const info = await lstat(name).catch(() => null);
  if (!info?.isFile()) continue;
  const key = name.includes('/') ? name.split('/')[0] : 'root';
  groups[key] = (groups[key] || 0) + info.size;
  total += info.size;
  files++;
}
async function bytes(dir) {
  let total = 0;
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, file.name);
    if (file.isDirectory()) total += await bytes(path);
    else if (file.isFile()) total += (await lstat(path)).size;
  }
  return total;
}
const budget = 8_388_608;
console.log(JSON.stringify({
  basis: 'Raw bytes of unique existing tracked and non-ignored files plus required revision response; not Git pack size or transfer compression.',
  files,
  groups,
  total,
  budget,
  headroom: budget - total,
  exportBytes: await bytes('dist'),
  modelBytes: await bytes('dist/models'),
  audioBytes: await bytes('dist/audio'),
  screenshotBytes: await bytes('docs/screenshots'),
}, null, 2));
if (total > budget) process.exitCode = 1;
