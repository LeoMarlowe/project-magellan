import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { thrusterNozzles } from '../vehicle-model.mjs';
const bytes = await readFile(new URL('../assets/vehicles/roadster-rocket.glb', import.meta.url));
const metadata = JSON.parse(await readFile(new URL('../assets/vehicles/roadster-rocket.json', import.meta.url), 'utf8'));
const { scene, animations } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
scene.updateMatrixWorld(true);
const bounds = object => new Box3().setFromObject(object, true);

test('Blender exports a compact, self-contained Roadster with no clips, images or lettering', () => {
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.ok(gltf.asset.generator.includes('Blender'));
  assert.ok(gltf.buffers.every(b => !b.uri)); assert.equal(gltf.images?.length ?? 0, 0);
  assert.equal(animations.length, 0);
  let meshes = 0, triangles = 0;
  scene.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  assert.ok(meshes <= 32, `${meshes} draws`); assert.ok(triangles < 25000, `${triangles} triangles`); assert.ok(bytes.length < 1024 * 1024);
  // Batched by material within the body and each wheel, as the export reports.
  assert.deepEqual(metadata.batching.map(b => b.group), ['Body', 'Spinner_FL', 'Spinner_RL', 'Spinner_FR', 'Spinner_RR', 'Rear_Wing']);
  // (The shell keeps its carbon wheel-arch liners as a second primitive.)
  assert.equal(scene.getObjectByName('Body').children.filter(o => !/^(Exhaust_|Rear_Wing$)/.test(o.name)).length, metadata.batching[0].after);
  // An original model: no badges, wordmarks or text anywhere.
  scene.traverse(o => assert.doesNotMatch(o.name, /tesla|spacex|logo|badge|wordmark|text|registration/i));
  assert.ok(!gltf.meshes.some(m => /text|font/i.test(m.name)));
});

test('the body matches the published proportions: 2.825 m wheelbase, 2 m wide, 1.1 m tall', () => {
  const body = bounds(scene.getObjectByName('Body')).getSize(new Vector3());
  assert.ok(Math.abs(body.x - 2.0) < .06, `width ${body.x}`);
  // 4.37 m of bodywork; the rear nozzles stand a little proud of it.
  assert.ok(body.z > 4.35 && body.z < 4.55, `length ${body.z}`);
  // The roof is 1.1 m up; only the Rocket's rear wing stands above it.
  const roof = bounds(scene.getObjectByName('Body__Gold_Glass'));
  assert.ok(Math.abs(roof.max.y - 1.1) < .03, `roof ${roof.max.y}`);
  assert.ok(body.y < 1.35);
  const front = scene.getObjectByName('Wheel_FL').getWorldPosition(new Vector3()), rear = scene.getObjectByName('Wheel_RL').getWorldPosition(new Vector3());
  assert.ok(Math.abs(front.z - rear.z - 2.82) < .01);
  assert.equal(metadata.wheelbase, 2.82); assert.equal(metadata.width, 2.0); assert.equal(metadata.height, 1.1);
});

test('wheel rigs sit on the ground at their tyre radii and turn independently of the body', () => {
  const body = scene.getObjectByName('Body'), before = bounds(body);
  for (const [name, x, radius, z] of [['FL', -.845, .343, 1.41], ['RL', -.83, .367, -1.41], ['FR', .845, .343, 1.41], ['RR', .83, .367, -1.41]]) {
    const pivot = scene.getObjectByName(`Wheel_${name}`), spinner = scene.getObjectByName(`Spinner_${name}`);
    assert.equal(spinner.parent, pivot);
    assert.ok(pivot.getWorldPosition(new Vector3()).distanceTo(new Vector3(x, radius, z)) < 1e-5, `wheel ${name} axle`);
    const tyre = bounds(spinner);
    assert.ok(Math.abs(tyre.min.y) < .01, `wheel ${name} meets the ground: ${tyre.min.y}`);
    assert.ok(Math.abs(tyre.max.y - 2 * radius) < .01);
    spinner.rotation.x = .73; pivot.rotation.y = z > 0 ? .2 : 0;
  }
  scene.updateMatrixWorld(true);
  const after = bounds(body);
  assert.ok(before.min.distanceTo(after.min) < 1e-9 && before.max.distanceTo(after.max) < 1e-9);
  for (const name of ['FL', 'RL', 'FR', 'RR']) { scene.getObjectByName(`Spinner_${name}`).rotation.x = 0; scene.getObjectByName(`Wheel_${name}`).rotation.y = 0; }
  scene.updateMatrixWorld(true);
  const materials = new Map();
  scene.traverse(o => { if (o.isMesh) for (const m of [o.material].flat()) materials.set(m.name, m); });
  assert.ok(materials.get('Headlamp').emissive.getHex() > 0);
  assert.ok(materials.get('Brake_Lamp').emissive.getHex() > 0);
  assert.notEqual(materials.get('Headlamp'), materials.get('Brake_Lamp'));
  assert.deepEqual([...materials.keys()].sort(), metadata.materials);
});

test('ten thruster nozzles in the reported Rocket layout, each with an exhaust mouth', () => {
  const nozzles = thrusterNozzles(scene);
  assert.equal(nozzles.rear.length, 4); assert.equal(nozzles.lift.length, 4);
  assert.equal(nozzles.yawL.length, 1); assert.equal(nozzles.yawR.length, 1);
  const body = bounds(scene.getObjectByName('Body')), at = n => n.node.getWorldPosition(new Vector3());
  // Four in the rear diffuser blowing backward, across the tail.
  for (const n of nozzles.rear) { assert.deepEqual(n.thrust.toArray(), [0, 0, -1]); assert.ok(at(n).z < -2.1 && at(n).y < .5); }
  assert.ok(Math.max(...nozzles.rear.map(n => at(n).x)) - Math.min(...nozzles.rear.map(n => at(n).x)) > 1);
  // Four at the corners blowing down, under the body, two at each end.
  for (const n of nozzles.lift) { assert.deepEqual(n.thrust.toArray(), [0, -1, 0]); assert.ok(at(n).y < .12 && Math.abs(at(n).z) > 1.8 && Math.abs(at(n).x) > .7); }
  assert.equal(nozzles.lift.filter(n => at(n).z > 0).length, 2);
  // Two on the flanks, ahead of centre, blowing out to either side to yaw.
  assert.deepEqual(nozzles.yawL[0].thrust.toArray(), [-1, 0, 0]); assert.deepEqual(nozzles.yawR[0].thrust.toArray(), [1, 0, 0]);
  for (const n of [...nozzles.yawL, ...nozzles.yawR]) assert.ok(at(n).z > .5 && Math.abs(Math.abs(at(n).x) - 1) < .02);
  // Every mouth sits at the car's skin, with a visible titanium bell behind it.
  for (const n of Object.values(nozzles).flat()) { assert.ok(body.distanceToPoint(at(n)) < .02); assert.ok(n.radius > .04 && n.radius < .09); }
  assert.equal(metadata.thrusters.length, 10);
  for (const t of metadata.thrusters) assert.ok(at({ node: scene.getObjectByName(t.name) }).distanceTo(new Vector3(...t.position)) < 1e-3);
});

test('the rear wing tilts on its own pivot into an air brake, leaving the body and pylons put', () => {
  const body = scene.getObjectByName('Body'), wing = scene.getObjectByName('Rear_Wing');
  assert.equal(wing.parent, body);
  assert.ok(wing.getWorldPosition(new Vector3()).distanceTo(new Vector3(0, 1.16, -1.97)) < 1e-4);
  // The wing carries its light; the pylons stay on the body.
  const parts = wing.children.filter(o => o.isMesh || o.isGroup).map(o => o.name);
  assert.ok(parts.includes('Rear_Wing__Brake_Lamp') && parts.includes('Rear_Wing__Carbon'));
  const flat = bounds(wing), rest = body.children.filter(o => o !== wing && !o.name.startsWith('Exhaust_')).map(o => bounds(o));
  wing.rotation.x = .95; scene.updateMatrixWorld(true);
  const raised = bounds(wing);
  // Trailing edge up, leading edge down: the wing stands up across the airflow.
  assert.ok(raised.max.y - raised.min.y > (flat.max.y - flat.min.y) * 1.8, 'it stands up');
  assert.ok(raised.min.y > .85, `clear of the deck: ${raised.min.y}`);
  body.children.filter(o => o !== wing && !o.name.startsWith('Exhaust_')).forEach((o, i) => assert.ok(bounds(o).equals(rest[i])));
  wing.rotation.x = 0; scene.updateMatrixWorld(true);
  assert.ok(bounds(wing).equals(flat));
});
