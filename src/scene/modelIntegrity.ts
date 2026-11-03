import { Mesh, MeshStandardMaterial, NoColorSpace, SRGBColorSpace, Texture, type Object3D } from 'three';

/** GLTFLoader deliberately turns texture errors into null maps. These five authored Pip
 * models all require colour, normal and packed roughness/metalness maps; a mesh alone is
 * never a successful load. Check decoded images and material semantics before installation. */
export function requireTexturedModel(root: Object3D): Mesh {
  let first: Mesh | undefined;
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    first ??= object;
    const geometry = object.geometry;
    const count = geometry.getAttribute('position')?.count;
    if (!count || geometry.getAttribute('normal')?.count !== count || geometry.getAttribute('uv')?.count !== count) {
      throw new Error('Pip geometry is missing authored normals or texture coordinates');
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial) || material.flatShading) throw new Error('Pip requires a smooth PBR material');
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
        const texture = material[slot];
        const image = texture?.image;
        if (!texture || !image || !(image.width > 0 && image.height > 0) || ('complete' in image && !image.complete)) {
          throw new Error(`Pip texture did not decode: ${slot}`);
        }
        if (texture.colorSpace !== (slot === 'map' ? SRGBColorSpace : NoColorSpace)) {
          throw new Error(`Pip texture has the wrong colour space: ${slot}`);
        }
      }
    }
  });
  if (!first) throw new Error('Pip model contains no mesh');
  return first;
}

/** Release abandoned loads and replaced stages, including ImageBitmap backing storage. */
export function disposeModel(root: Object3D) {
  const textures = new Set<NonNullable<MeshStandardMaterial['map']>>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      material.dispose();
    }
  });
  const images = new Set<unknown>();
  for (const texture of textures) {
    texture.dispose();
    if (!images.has(texture.image)) texture.image?.close?.();
    images.add(texture.image);
  }
}
