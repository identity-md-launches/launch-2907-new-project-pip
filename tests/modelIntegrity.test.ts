import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, NoColorSpace, SRGBColorSpace, Texture } from 'three';
import { requireTexturedModel } from '../src/scene/modelIntegrity';

function model() {
  const geometry = new BufferGeometry();
  for (const [key, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
    geometry.setAttribute(key, new Float32BufferAttribute(new Float32Array(size * 3), size));
  }
  const material = new MeshStandardMaterial();
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
    const texture = new Texture({ width: 1024, height: 1024 } as TexImageSource);
    texture.colorSpace = key === 'map' ? SRGBColorSpace : NoColorSpace;
    material[key] = texture;
  }
  return new Mesh(geometry, material);
}

describe('Pip ready requires decoded authored materials', () => {
  it('accepts a smooth fully textured model with sRGB colour and linear data maps', () => {
    const mesh = model();
    expect(requireTexturedModel(mesh)).toBe(mesh);
  });
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
    it(`rejects a silently dropped ${key}`, () => {
      const mesh = model();
      mesh.material[key] = null;
      expect(() => requireTexturedModel(mesh)).toThrow('did not decode');
    });
    it(`rejects a zero-size decoded ${key}`, () => {
      const mesh = model();
      mesh.material[key]!.image = { width: 0, height: 1024 };
      expect(() => requireTexturedModel(mesh)).toThrow('did not decode');
    });
    it(`rejects incorrect ${key} colour space`, () => {
      const mesh = model();
      mesh.material[key]!.colorSpace = key === 'map' ? NoColorSpace : SRGBColorSpace;
      expect(() => requireTexturedModel(mesh)).toThrow('wrong colour space');
    });
  }
  it('rejects an incomplete HTML image', () => {
    const mesh = model();
    mesh.material.map!.image = { width: 1024, height: 1024, complete: false };
    expect(() => requireTexturedModel(mesh)).toThrow('did not decode');
  });
  it('checks every mesh, not only the first', () => {
    const root = new Group();
    root.add(model());
    const second = model();
    second.material.normalMap = null;
    root.add(second);
    expect(() => requireTexturedModel(root)).toThrow('normalMap');
  });
  it('rejects missing or faceted authored normals', () => {
    const mesh = model();
    mesh.material.flatShading = true;
    expect(() => requireTexturedModel(mesh)).toThrow('smooth');
    mesh.material.flatShading = false;
    mesh.geometry.deleteAttribute('normal');
    expect(() => requireTexturedModel(mesh)).toThrow('normals');
  });
  it('rejects geometry without texture coordinates and empty scenes', () => {
    const mesh = model();
    mesh.geometry.deleteAttribute('uv');
    expect(() => requireTexturedModel(mesh)).toThrow('texture coordinates');
    expect(() => requireTexturedModel(new Group())).toThrow('no mesh');
  });
});
