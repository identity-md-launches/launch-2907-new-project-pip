import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../docs/texture-integrity.json' with { type: 'json' };

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
describe('all five published models preserve the original authored payloads', () => {
  for (const stage of manifest.stages) {
    it(`${stage.model}: relative images, byte-identical compressed geometry and material definitions`, () => {
      const bytes = readFileSync(`public/models/${stage.model}`);
      const n = bytes.readUInt32LE(12);
      const json = JSON.parse(bytes.subarray(20, 20 + n).toString());
      const bin = bytes.subarray(28 + n);
      assert.equal(bytes.readUInt32LE(8), bytes.length);
      assert.equal(json.images.length, 3);
      for (const expected of stage.images) {
        const im = json.images.find((image) => image.uri === expected.uri);
        assert.ok(im);
        assert.equal(im.bufferView, undefined);
        assert.equal(im.mimeType, 'image/webp');
        assert.doesNotMatch(im.uri, /^(?:https?:|blob:|data:|\/)/);
        const image = readFileSync(`public/models/${expected.uri}`);
        assert.equal(image.length, expected.bytes);
        assert.equal(sha(image), expected.sha256);
      }
      assert.deepEqual(json.materials, [stage.material]);
      assert.equal(json.bufferViews.length, stage.compressedGeometry.length);
      json.bufferViews.forEach((view, i) => {
        const compression = view.extensions.EXT_meshopt_compression;
        const expected = stage.compressedGeometry[i];
        assert.equal(sha(bin.subarray(compression.byteOffset, compression.byteOffset + compression.byteLength)), expected.sha256);
        for (const key of ['count', 'byteStride', 'mode']) assert.equal(compression[key], expected[key]);
        assert.equal(compression.filter || null, expected.filter);
      });
    });
  }
});
