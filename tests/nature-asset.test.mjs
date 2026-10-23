import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { assembleNatureLibrary } from '../nature-models.mjs';
import { createTreeBreakage } from '../tree-breakage.mjs';
import { cloneOwnedGeometry } from '../scenery.mjs';

const bytes = await readFile(new URL('../assets/nature/endless-nature.glb', import.meta.url));
const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const library = assembleNatureLibrary(scene);

test('Blender scenery contains eighteen colored, correctly scaled assets with bounded geometry', () => {
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.ok(json.asset.generator.includes('Blender'));
  assert.ok(json.buffers.every(b => !b.uri)); assert.equal(json.images?.length ?? 0, 0);
  assert.ok(bytes.length < 1.5 * 1024 * 1024);
  assert.equal(library.stats.length, 18);
  const counts = { tree: 5, cactus: 2, rock: 2, boulder: 2, bush: 3, outcrop: 3, scree: 1 };
  for (const [kind, variants] of Object.entries(library.variants)) {
    assert.equal(variants.length, counts[kind], kind);
    for (const [variant, { geometry, material }] of variants.entries()) {
      assert.equal(material.vertexColors, true); assert.equal(material.transparent, false);
      const { position, normal, color } = geometry.attributes;
      assert.equal(position.count, color.count); assert.equal(normal.count, position.count);
      assert.ok(position.count / 3 < (kind === 'tree' ? 1700 : kind === 'cactus' ? 1250 : kind === 'outcrop' ? 600 : 350));
      for (const attribute of [position, normal, color]) assert.ok([...attribute.array].every(Number.isFinite));
      assert.ok([...color.array].every(c => c >= 0 && c <= 1));
      assert.ok(new Set(color.array).size > 6, 'authored color variation survives glTF export');
      const size = geometry.boundingBox.getSize(new THREE.Vector3());
      // Outcrops run a metre or more into the ground so they sit into slopes.
      if (kind === 'outcrop') assert.ok(geometry.boundingBox.min.y < -.8 && geometry.boundingBox.min.y > -2.5, 'outcrops are rooted in the ground');
      else assert.ok(geometry.boundingBox.min.y > -.2 && geometry.boundingBox.min.y <= .05, 'origin sits at ground level');
      assert.ok(size.x < (kind === 'tree' ? 4.3 : kind === 'outcrop' || kind === 'scree' ? 8 : 3.1));
      // Tall pines (alpine, windswept, snow), the stunted treeline pine, the dead snag.
      if (kind === 'tree') assert.ok(variant === 3 ? size.y > 3 && size.y < 3.8 : variant === 4 ? size.y > 5 && size.y < 6.6 : size.y > 6.3 && size.y < 6.9, `tree ${variant}: ${size.y}`);
      if (kind === 'cactus') assert.ok(size.y > 3.8 && size.y < 4.8);
      if (kind === 'rock') assert.ok(size.y < .8);
      if (kind === 'boulder') assert.ok(size.y > 1.5 && size.y < 2.1);
    }
  }
});

test('scenery variants are stable across chunk reloads and templates keep independent color buffers', () => {
  const found = new Set();
  for (let i = -30; i <= 30; i++) {
    const prop = { type: 'tree', x: i * 7.123, z: i * 2.819 };
    const variant = library.variantFor(prop); found.add(variant);
    assert.equal(variant, library.variantFor({ ...prop }));
  }
  assert.equal(found.size, 2);
  const template = library.variants.tree[0].geometry;
  const a = cloneOwnedGeometry(template), b = cloneOwnedGeometry(template);
  a.setAttribute('groundDelta', new THREE.InstancedBufferAttribute(new Float32Array([1, 2]), 1));
  a.attributes.color.setX(0, 1);
  assert.notEqual(a.attributes.color.getX(0), b.attributes.color.getX(0));
  assert.equal(template.hasAttribute('groundDelta'), false);
  assert.equal(template.userData.owned, undefined);
  a.dispose(); b.dispose();
});

test('every imported tree retains its complete colored surfaces at impact, with a shared fragment capacity', () => {
  const ground = { surface: () => 0 };
  for (let variant = 0; variant < 5; variant++) {
    const scene = new THREE.Scene(), effect = createTreeBreakage(scene, library.treeSources);
    const original = new THREE.Mesh(library.variants.tree[variant].geometry, library.material);
    effect.burst({ x: 0, y: .08, z: 0, turn: 0, size: 1, vx: 0, vz: 83.3, variant });
    effect.update(0, ground); scene.updateMatrixWorld(true);
    const active = scene.children.filter(mesh => mesh.count);
    assert.equal(active.length, 6);
    assert.ok(active.every(mesh => mesh.material.vertexColors && mesh.geometry.hasAttribute('color')));
    const a = new THREE.Box3().setFromObject(original, true), b = new THREE.Box3().setFromObject(scene);
    assert.ok(a.min.distanceTo(b.min) < 1e-5); assert.ok(a.max.distanceTo(b.max) < 1e-5);
    // Actual branch gaps and surfaces must agree, including rays through the crown.
    for (let angle = 0; angle < 8; angle++) for (let y = .2; y < 6.8; y += .29) {
      const direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      const ray = new THREE.Raycaster(new THREE.Vector3(0, y, 0).addScaledVector(direction, 12), direction.negate());
      const before = ray.intersectObject(original)[0], after = ray.intersectObject(scene)[0];
      assert.equal(Boolean(before), Boolean(after));
      if (before) assert.ok(Math.abs(before.distance - after.distance) < 1e-5);
    }
    effect.clear();
    for (let i = 0; i < 20; i++) effect.burst({ x: i, y: .08, z: 0, turn: 0, size: 1, vx: 30, vz: 60, variant: i % 2 });
    effect.update(.08, ground);
    assert.equal(effect.count, 8);
    assert.equal(scene.children.reduce((n, mesh) => n + mesh.count, 0), 48);
    effect.update(3, ground); assert.equal(effect.count, 0);
    assert.ok(scene.children.every(mesh => mesh.count === 0));
  }
});
