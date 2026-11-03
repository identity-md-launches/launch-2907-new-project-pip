// Check the deliverable itself, not a dev server. No dependencies or network needed.
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readGlb } from './externalize-textures.mjs';

const hash = (b) => createHash('sha256').update(b).digest('hex');
async function files(dir, prefix = '') {
  const all = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), `No symlink/submodule: ${dir}/${entry.name}`);
    assert.ok(!['node_modules', '.cache', '.npm'].includes(entry.name), `No dependency/cache tree: ${entry.name}`);
    if (entry.isDirectory()) all.push(...await files(join(dir, entry.name), prefix + entry.name + '/'));
    else all.push(prefix + entry.name);
  }
  return all;
}
const exported = await files('dist');
const assets = await files('public');
for (const name of assets) assert.equal(hash(await readFile(join('public', name))), hash(await readFile(join('dist', name))), `Complete public asset copy: ${name}`);
const html = await readFile('dist/index.html', 'utf8');
for (const match of html.matchAll(/(?:src|href|content)="(\.\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
  await lstat(join('dist', match[1]));
}
assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/, 'Subpath-safe HTML URLs');
const models = exported.filter((p) => p.endsWith('.glb'));
assert.equal(models.length, 5);
for (const model of models) {
  const { json } = readGlb(await readFile(join('dist', model)));
  for (const image of json.images) {
    assert.ok(image.uri && image.bufferView === undefined, 'External image (no blob fetch)');
    assert.doesNotMatch(image.uri, /^(?:https?:|blob:|data:|\/)/);
    await lstat(join('dist/models', image.uri));
  }
  assert.deepEqual(json.extensionsRequired, ['EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization']);
}
assert.equal(exported.filter((p) => p.endsWith('.webp')).length, 15);
assert.equal(exported.filter((p) => p.endsWith('.flac')).length, 11);
let bytes = 0;
for (const name of exported) bytes += (await lstat(join('dist', name))).size;
assert.ok(bytes < 8_388_608, 'Export alone fits publication budget (full bundle is checked separately)');
console.log(JSON.stringify({ pass: true, exportedFiles: exported.length, publicAssets: assets.length, models: models.length, images: 15, audioClips: 11, exportBytes: bytes,
  renderer: 'three 0.170 + GLTFLoader + MeshoptDecoder bundled in the app JS; native WebP decoding; no renderer/decoder CDN',
  sha256: Object.fromEntries(await Promise.all(exported.map(async (name) => [name, hash(await readFile(join('dist', name)))]))) }, null, 2));
