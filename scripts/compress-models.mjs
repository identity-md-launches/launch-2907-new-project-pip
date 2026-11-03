// Re-encodes the five authorised Pip growth meshes for static hosting.
// Geometry: meshopt (EXT_meshopt_compression) + KHR_mesh_quantization; the authored vertex
// normals are kept (12-bit octahedral), never recomputed, so the authored smoothing survives.
// Textures: resized to 1024 px and re-encoded as WebP.
// Usage (outside the repo's dependency tree, see README "Rebuilding the models"):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
//   node scripts/compress-models.mjs <reference dist/assets/growth-web dir> public/models
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, textureCompress, quantize, dedup, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [src, out] = process.argv.slice(2);
const names = ['01-tiny-bean', '02-milk-mochi', '03-curious-baby', '04-lively-youngster', '05-little-guardian'];
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
fs.mkdirSync(out, { recursive: true });
for (const name of names) {
  const file = fs.readdirSync(src).find((f) => f.startsWith(name) && f.endsWith('.glb'));
  const doc = await io.read(path.join(src, file));
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'FB_ngon_encoding' || ext.extensionName === 'KHR_materials_volume') ext.dispose();
  }
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
    quantize({ quantizePosition: 14, quantizeNormal: 12, quantizeTexcoord: 12 }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const target = path.join(out, `${name}.glb`);
  await io.write(target, doc);
  console.log(target, fs.statSync(target).size);
}
