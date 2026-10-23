import * as THREE from 'three';
import { random, hash } from './world.mjs?v=rivers-1';

// One draw call and a fixed particle pool, even when ploughing through a grove.
export function createDebris(scene, capacity = 192) {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const material = new THREE.MeshStandardMaterial({ roughness: .95 });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
  // Give it instance colours from the start: adding them on the first burst
  // would rebuild its shader mid-drive (a visible hitch on the first crash).
  mesh.setColorAt(0, new THREE.Color('#ffffff'));
  mesh.count = 0; scene.add(mesh);
  const pieces = [], dummy = new THREE.Object3D(), color = new THREE.Color();
  function burst(prop) {
    const rng = random(hash(Math.round(prop.x), Math.round(prop.z), 701) * 4294967296);
    const tree = prop.type === 'tree', cactus = prop.type === 'cactus';
    for (let i = 0; i < (tree ? 6 : 12); i++) {
      if (pieces.length >= capacity) pieces.shift();
      const leafy = tree && i > 4, size = prop.size * (tree ? .06 + rng() * .12 : .2 + rng() * .35);
      pieces.push({ x: prop.x + (rng() - .5) * prop.size, y: prop.y + .3 + rng() * (tree ? 1.2 : prop.h), z: prop.z + (rng() - .5) * prop.size,
        vx: prop.vx * (.12 + rng() * .15) + (rng() - .5) * 9, vy: 3 + rng() * 7, vz: prop.vz * (.12 + rng() * .15) + (rng() - .5) * 9,
        rx: rng() * 6, rz: rng() * 6, spin: (rng() - .5) * 12, age: 0, size,
        tall: (tree && !leafy || cactus) ? 2.4 : 1,
        color: cactus ? '#63824b' : leafy ? '#426547' : tree ? '#91724c' : '#92958a' });
    }
  }
  function update(dt, world) {
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i]; p.age += dt;
      if (p.age >= 3.5) { pieces.splice(i, 1); continue; }
      p.vy -= 18 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.spin * dt; p.rz += p.spin * .7 * dt;
      const floor = world.surface(p.x, p.z) + p.size * .5;
      if (p.y < floor) { p.y = floor; p.vy = Math.abs(p.vy) * .25; p.vx *= .7; p.vz *= .7; p.spin *= .6; }
    }
    mesh.count = pieces.length;
    pieces.forEach((p, i) => {
      const size = p.size * Math.min(1, (3.5 - p.age) / .7);
      dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.rx, 0, p.rz); dummy.scale.set(size, size * p.tall, size); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, color.set(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  return { burst, update, clear() { pieces.length = 0; mesh.count = 0; }, get count() { return pieces.length; } };
}
