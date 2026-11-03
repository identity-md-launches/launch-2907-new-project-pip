// Keep the existing Meshopt geometry and WebP pixels byte-for-byte, but serve images as
// relative files. ImageBitmapLoader fetches embedded GLB images through blob: URLs, which
// the publication host's connect-src deliberately does not allow.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function readGlb(bytes) {
  const b = Buffer.from(bytes);
  if (b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length) throw new Error('Invalid GLB');
  const n = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a || b.readUInt32LE(24 + n) !== 0x004e4942) throw new Error('Expected JSON and BIN chunks');
  return { json: JSON.parse(b.subarray(20, 20 + n).toString()), bin: b.subarray(28 + n, 28 + n + b.readUInt32LE(20 + n)) };
}

export function externalizeTextures(bytes, stem) {
  const { json, bin } = readGlb(bytes);
  if (json.images.every((im) => im.uri && im.bufferView === undefined)) return { glb: Buffer.from(bytes), images: [] };
  // glTF-Transform's existing output stores the three images first, followed by Meshopt data.
  // Refuse an unfamiliar layout rather than risk moving geometry or losing a reference.
  const views = json.images.map((im) => im.bufferView);
  if (!views.every((v, i) => v === i)) throw new Error('Expected leading image bufferViews');
  let prefix = 0;
  const images = json.images.map((im, i) => {
    const view = json.bufferViews[i];
    if (im.mimeType !== 'image/webp' || view.buffer !== 0 || (view.byteOffset || 0) !== prefix) throw new Error('Unexpected image layout');
    const data = bin.subarray(prefix, prefix + view.byteLength);
    if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Expected WebP bytes');
    // glTF-Transform aligns these payloads to 8 bytes (GLB chunks themselves use 4).
    prefix = (prefix + view.byteLength + 7) & ~7;
    const role = im.name.includes('basecolor') ? 'basecolor' : im.name.includes('normal') ? 'normal' : 'rm';
    const uri = `${stem}-${role}.webp`;
    delete im.bufferView;
    im.uri = uri;
    return { uri, data };
  });
  for (const accessor of json.accessors) {
    if (accessor.bufferView < views.length || accessor.sparse) throw new Error('Unexpected accessor layout');
    accessor.bufferView -= views.length;
  }
  json.bufferViews = json.bufferViews.slice(views.length);
  for (const view of json.bufferViews) {
    for (const v of [view, view.extensions?.EXT_meshopt_compression].filter(Boolean)) {
      if (v.buffer === 0) {
        if ((v.byteOffset || 0) < prefix) throw new Error('Geometry overlaps image prefix');
        v.byteOffset -= prefix;
      }
    }
  }
  json.buffers[0].byteLength -= prefix;
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc((jsonBytes.length + 3) & ~3, 0x20);
  jsonBytes.copy(jsonChunk);
  const geometry = bin.subarray(prefix);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonChunk.length + geometry.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(geometry.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return { glb: Buffer.concat([header, jsonChunk, binHeader, geometry]), images };
}

export async function externalizeDirectory(dir) {
  await mkdir(dir, { recursive: true });
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.glb')).sort()) {
    const { glb, images } = externalizeTextures(await readFile(join(dir, name)), basename(name, '.glb'));
    for (const im of images) await writeFile(join(dir, im.uri), im.data);
    await writeFile(join(dir, name), glb);
    console.log(`${name}: ${glb.length} geometry/container bytes, ${images.length} images extracted`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await externalizeDirectory(resolve(process.argv[2] || 'public/models'));
}
