import * as THREE from 'three';
import { featurePoint, hash } from './world.mjs?v=classes-2';

// Three.js BufferGeometry.clone() shares userData with its source. Detach it
// before marking ownership, or the shared template becomes disposable too.
export function cloneOwnedGeometry(source) {
  const geometry = source.clone();
  geometry.userData = { ...source.userData, owned: true };
  return geometry;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const materials = {
  timber: new THREE.MeshStandardMaterial({ color: '#806748', roughness: .9 }),
  dark: new THREE.MeshStandardMaterial({ color: '#38433b', roughness: .8 }),
  orange: new THREE.MeshStandardMaterial({ color: '#db853e', roughness: .8 }),
  cream: new THREE.MeshStandardMaterial({ color: '#e9dcaa', roughness: .8 }),
  green: new THREE.MeshStandardMaterial({ color: '#4c7162', roughness: .8 }),
  glass: new THREE.MeshStandardMaterial({ color: '#466b72', metalness: .2, roughness: .35 }),
};
const deckMaterials = new Map();
function getDeckMaterial(twist = 0) {
  if (deckMaterials.has(twist)) return deckMaterials.get(twist);
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 512;
  const g = canvas.getContext('2d');
  g.fillStyle = twist ? '#8758ae' : '#bc7542'; g.fillRect(0, 0, 256, 512);
  g.fillStyle = '#553e2c'; for (let y = 0; y < 512; y += 18) g.fillRect(0, y, 256, 2);
  g.fillStyle = '#f1d789'; g.fillRect(6, 0, 10, 512); g.fillRect(240, 0, 10, 512);
  g.strokeStyle = '#f8e5ab'; g.lineWidth = 14;
  for (let y = 125; y < 480; y += 120) { g.beginPath(); g.moveTo(70, y); g.lineTo(128, y - 42); g.lineTo(186, y); g.stroke(); }
  if (twist) {
    g.strokeStyle = '#fff2bc'; g.lineWidth = 9;
    for (let y = 180; y < 490; y += 170) {
      g.beginPath(); g.arc(128, y, 55, .3, Math.PI * 1.8); g.stroke();
      const x = twist > 0 ? 181 : 75;
      g.beginPath(); g.moveTo(x - 14, y + 8); g.lineTo(x, y - 14); g.lineTo(x + 14, y + 8); g.stroke();
    }
  }
  for (let x = 0; x < 256; x += 32) { g.fillStyle = x % 64 ? '#e9c875' : '#343c32'; g.fillRect(x, 0, 32, 22); }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map, roughness: .9, polygonOffset: true, polygonOffsetFactor: -2 });
  deckMaterials.set(twist, material); return material;
}

export function buildLandmark(feature, world) {
  const group = new THREE.Group(), buckets = new Map();
  const baseY = world.surface(feature.x, feature.z);
  group.position.set(feature.x, baseY, feature.z); group.rotation.y = feature.heading;
  const temp = new THREE.Object3D();
  function box(w, h, d, x, y, z, material = 'timber', rx = 0, ry = 0, rz = 0) {
    temp.position.set(x, y, z); temp.rotation.set(rx, ry, rz); temp.scale.set(w, h, d); temp.updateMatrix();
    if (!buckets.has(material)) buckets.set(material, []);
    buckets.get(material).push(temp.matrix.clone());
  }
  function ground(x, z) { const p = featurePoint(feature, x, z); return world.surface(p.x, p.z) - baseY; }
  function flag(x, z, height = 5.8) {
    const y = ground(x, z);
    box(.13, height, .13, x, y + height / 2, z, 'dark');
    box(1.2, 2.6, .06, x + .6, y + height - 1.4, z, 'orange');
    box(.65, .2, .07, x + .62, y + height - 1, z, 'cream');
    box(.65, .2, .07, x + .62, y + height - 1.65, z, 'cream');
  }
  if (feature.type === 'ramp') {
    const positions = [], uv = [], indices = [], acrossSteps = Math.ceil(feature.width), alongSteps = Math.ceil(feature.length);
    for (let j = 0; j <= alongSteps; j++) for (let i = 0; i <= acrossSteps; i++) {
      const x = (i / acrossSteps - .5) * feature.width, z = j / alongSteps * feature.length;
      positions.push(x, ground(x, z) + .075, z); uv.push(i / acrossSteps, j / alongSteps);
    }
    for (let j = 0; j < alongSteps; j++) for (let i = 0; i < acrossSteps; i++) {
      const a = j * (acrossSteps + 1) + i, b = a + 1, c = a + acrossSteps + 1;
      indices.push(a, c, b, b, c, c + 1);
    }
    const geometry = new THREE.BufferGeometry(); geometry.userData.owned = true;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const deck = new THREE.Mesh(geometry, getDeckMaterial(feature.twist)); deck.receiveShadow = true; group.add(deck);
    for (const side of [-1, 1]) {
      flag(side * (feature.width / 2 + 1), feature.length - .8);
      for (const z of [-20, -10, 0]) {
        const x = side * (feature.width / 2 + 1.5), y = ground(x, z);
        box(.25, 1.2, .25, x, y + .6, z, 'orange');
        box(.29, .25, .29, x, y + .85, z, 'cream');
      }
    }
  } else if (feature.type === 'lookout') {
    const foundation = Math.max(0, ground(-2, -2), ground(2, -2), ground(-2, 2), ground(2, 2));
    for (const x of [-1.7, 1.7]) for (const z of [-1.7, 1.7]) {
      const bottom = ground(x, z), h = foundation + 8 - bottom;
      box(.35, h, .35, x, bottom + h / 2, z);
    }
    for (const x of [-1.7, 1.7]) for (const z of [-.9, .9]) box(.15, 4.3, .15, x, foundation + 3.8, z, 'timber', z > 0 ? -.5 : .5);
    box(4.5, .3, 4.5, 0, foundation + 7.3, 0);
    for (const side of [-1, 1]) {
      box(4.5, .14, .14, 0, foundation + 8.6, side * 2.13, 'cream');
      box(.14, .14, 4.5, side * 2.13, foundation + 8.6, 0, 'cream');
      for (const z of [-2.1, 0, 2.1]) box(.14, 1.2, .14, side * 2.1, foundation + 7.95, z);
    }
    for (const x of [-1.65, 1.65]) for (const z of [-1.65, 1.65]) box(.14, 3, .14, x, foundation + 8.85, z, 'dark');
    for (const side of [-1, 1]) box(2.8, .15, 5.0, side * 1.17, foundation + 10.65, 0, 'orange', 0, 0, side * .3);
    for (const x of [-.5, .5]) box(.11, 8.4, .11, x, foundation + 3.8, -2, 'dark');
    for (let y = .2; y < 7.5; y += .45) box(1.05, .08, .12, 0, foundation + y, -2, 'cream');
    flag(4, 2, 6.2);
  } else {
    const foundation = Math.max(ground(-3, -2), ground(3, -2), ground(-3, 2), ground(3, 2)) + .35;
    box(6.3, .35, 4.7, 0, foundation, 0, 'dark');
    box(5.8, 2.9, 4.2, 0, foundation + 1.55, 0, 'timber');
    for (const side of [-1, 1]) box(3.6, .18, 5.3, side * 1.5, foundation + 3.75, 0, 'green', 0, 0, side * .32);
    box(1.05, 2.05, .1, .9, foundation + 1.2, -2.15, 'dark');
    box(1.5, 1, .11, -1.4, foundation + 1.95, -2.16, 'cream');
    box(1.27, .78, .12, -1.4, foundation + 1.95, -2.17, 'glass');
    box(7.6, .2, 2.4, 0, foundation - .1, -3.1);
    for (const x of [-3.4, 3.4]) box(.15, 3.4, .15, x, foundation + 1.4, -4, 'dark');
    box(7.6, .16, 2.5, 0, foundation + 3, -3.2, 'cream', -.08);
    const tableY = ground(9, -1);
    box(3, .2, 1.4, 9, tableY + 1, -1, 'cream');
    for (const side of [-1, 1]) { box(3.3, .15, .45, 9, tableY + .5, -1 + side * 1.2); box(.17, 1, 2.9, 9 + side, tableY + .48, -1); }
    for (let i = 0; i < 3; i++) box(1.25, 1.25, 1.25, -6.2, ground(-6.2, i * 1.5) + .625, i * 1.5, i === 1 ? 'orange' : 'green');
    flag(-8, -5, 6);
  }
  // Each material is one draw call, regardless of how many beams or boards it uses.
  for (const [name, matrices] of buckets) {
    const mesh = new THREE.InstancedMesh(unitBox, materials[name], matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix)); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  return group;
}

// Each landmark swaps between its real model and its stand-in at one distance,
// measured from its centre, so the whole ramp or building changes at once.
export const landmarkSwapDistance = feature => 300 + 60 * hash(Math.round(feature.x * 4), Math.round(feature.z * 4), 9151);
const DECK_COLORS = { 0: new THREE.Color('#c27f4c'), 1: new THREE.Color('#9168b4') };
// One merged, vertex-coloured mesh standing in for every landmark on a far
// tile (one draw call), built from the same geometry as the real landmarks.
// Each vertex carries its landmark's centre and swap distance, and how far the
// coarse and horizon terrain tiers sit from the real ground beneath it, so the
// stand-in rests on whichever tier is drawn. Positions are relative to origin.
export function buildLandmarkStandins(features, world, terrain, origin) {
  const position = [], normal = [], color = [], ground = [], swap = [], center = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Matrix4(), instance = new THREE.Matrix4(), normals = new THREE.Matrix3();
  const box = unitBox.index ? unitBox.toNonIndexed() : unitBox;
  // Each ground point is sampled once (a non-indexed deck repeats every corner).
  const sampled = new Map();
  const deltas = (x, z) => {
    const key = `${Math.round(x * 8)},${Math.round(z * 8)}`;
    let d = sampled.get(key);
    if (!d) { const fine = world.surface(x, z); d = [terrain.coarseSample(x, z).height - fine, terrain.ultraSample(x, z).height - fine]; sampled.set(key, d); }
    return d;
  };
  for (const feature of features) {
    const group = buildLandmark(feature, world); group.updateMatrixWorld(true);
    const at = landmarkSwapDistance(feature);
    const push = (geometry, matrix, tint, groundAt) => {
      normals.getNormalMatrix(matrix);
      const p = geometry.getAttribute('position'), q = geometry.getAttribute('normal');
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(matrix); n.fromBufferAttribute(q, i).applyMatrix3(normals).normalize();
        position.push(v.x - origin.x, v.y, v.z - origin.z); normal.push(n.x, n.y, n.z); color.push(tint.r, tint.g, tint.b);
        ground.push(...(groundAt ?? deltas(v.x, v.z))); swap.push(at); center.push(feature.x, feature.z);
      }
    };
    for (const child of group.children) {
      if (child.isInstancedMesh) {
        for (let k = 0; k < child.count; k++) {
          child.getMatrixAt(k, instance); m.multiplyMatrices(child.matrixWorld, instance);
          v.setFromMatrixPosition(m);
          push(box, m, child.material.color, deltas(v.x, v.z)); // boxes stay rigid, as the real ones do
        }
      } else if (child.isMesh) {
        push(child.geometry.index ? child.geometry.toNonIndexed() : child.geometry, child.matrixWorld, DECK_COLORS[feature.twist ? 1 : 0]);
      }
    }
    group.traverse(o => { if (o.isMesh && o.geometry.userData.owned) o.geometry.dispose(); });
  }
  if (!position.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3)); geometry.setAttribute('groundDeltas', new THREE.Float32BufferAttribute(ground, 2));
  geometry.setAttribute('swapAt', new THREE.Float32BufferAttribute(swap, 1)); geometry.setAttribute('swapCenter', new THREE.Float32BufferAttribute(center, 2));
  geometry.computeBoundingSphere(); geometry.boundingSphere.radius += 40;
  return geometry;
}
