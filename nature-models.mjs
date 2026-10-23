import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

export const NATURE_URL = new URL('./assets/nature/endless-nature.glb?v=nature-2', import.meta.url);
const names = {
  tree: ['Pine_Alpine', 'Pine_Windswept', 'Pine_Snow', 'Pine_Stunted', 'Tree_Dead'],
  cactus: ['Cactus_Saguaro', 'Cactus_Forked'],
  rock: ['Rock_Granite', 'Rock_Shale'],
  boulder: ['Boulder_Granite', 'Boulder_Sandstone'],
  bush: ['Bush_Meadow', 'Bush_Desert', 'Bush_Juniper'],
  outcrop: ['Outcrop_Granite', 'Outcrop_Sandstone', 'Outcrop_Slab'],
  scree: ['Scree_Field'],
};
// The world picks the special trees, bushes and outcrops by place
// (prop.variant, numbered as in world.mjs VARIANT and in the order above).
// Without one, a prop's position picks among the everyday variants.
const everyday = { tree: 2, bush: 1 };

function mergeParts(parts) {
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const result = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const data = new Float32Array(count * 3); let at = 0;
    for (const part of parts) {
      const attribute = part.getAttribute(name);
      for (let i = 0; i < attribute.count; i++) {
        data[at++] = attribute.getX(i); data[at++] = attribute.getY(i); data[at++] = attribute.getZ(i);
      }
    }
    result.setAttribute(name, new THREE.BufferAttribute(data, 3));
  }
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

// This pure assembly step is shared by the game, visual preview and asset tests.
export function assembleNatureLibrary(scene) {
  scene.updateMatrixWorld(true);
  const variants = {}, treeSources = [], stats = [];
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .94 });
  for (const [kind, list] of Object.entries(names)) {
    variants[kind] = list.map((name, variant) => {
      const root = scene.getObjectByName(name);
      if (!root) throw new Error(`Scenery asset is missing ${name}`);
      const inverse = root.matrixWorld.clone().invert(), parts = [];
      root.traverse(node => {
        if (!node.isMesh) return;
        const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
        if (!geometry.hasAttribute('color')) throw new Error(`${name} is missing its vertex colors`);
        parts.push(geometry);
      });
      if (!parts.length) throw new Error(`${name} contains no geometry`);
      const geometry = mergeParts(parts);
      if (kind === 'tree') {
        const fragments = parts.map(part => {
          const geometry = mergeParts([part]); geometry.computeBoundingBox();
          const center = geometry.boundingBox.getCenter(new THREE.Vector3());
          const half = geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(.5);
          geometry.translate(-center.x, -center.y, -center.z);
          return { geometry, center, half };
        });
        treeSources.push({ fragments, color: '#ffffff', vertexColors: true, variant });
      }
      for (const part of parts) part.dispose();
      stats.push({ name, kind, triangles: geometry.attributes.position.count / 3, fragments: kind === 'tree' ? parts.length : 0 });
      return { name, geometry, material };
    });
  }
  // Layout transforms exist only for the Blender studio. Runtime instances use
  // each model's ground origin, and keep the world's existing seeded transforms.
  scene.traverse(node => {
    if (node.isMesh) {
      node.geometry.dispose();
      for (const mat of Array.isArray(node.material) ? node.material : [node.material]) mat.dispose();
    }
  });
  function variantFor(prop) {
    const count = variants[prop.type]?.length ?? 1;
    if (prop.variant !== undefined && prop.variant >= 0) return Math.min(prop.variant, count - 1);
    const pool = Math.min(count, everyday[prop.type] ?? count);
    const seed = Math.imul(Math.round(prop.x * 8), 73856093) ^ Math.imul(Math.round(prop.z * 8), 19349663);
    return (seed >>> 0) % pool;
  }
  return { variants, treeSources, material, stats, variantFor };
}

export async function loadNatureLibrary() {
  return assembleNatureLibrary((await new GLTFLoader().loadAsync(NATURE_URL.href)).scene);
}
