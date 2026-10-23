import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createVehicle, stepVehicle, FIXED_DT } from '../world.mjs';

// Two seeds' roads and rivers within 3 km of the start, worked out once.
const RADIUS = 3000;
const worlds = [3, 11].map(seed => { const world = createWorld(seed); world.prepareRoads(0, 0, RADIUS, Infinity); return world; });
const roadsOf = world => world.roadsNear(0, 0, RADIUS);
const bridgesOf = world => roadsOf(world).flatMap(road => road.bridges.map(bridge => ({ road, bridge, unit: road.length / (road.count - 1) })));

test('roads follow the land: evenly spaced points, an 11% grade at most, and junctions that meet', () => {
  for (const world of worlds) {
    const roads = roadsOf(world), junctions = new Map();
    assert.ok(roads.length > 20, `seed ${world.seed}: ${roads.length} roads`);
    for (const road of roads) {
      const unit = road.length / (road.count - 1);
      assert.ok(unit > 9.5 && unit < 10.5, `${road.id}: points every ${unit} m`);
      for (let k = 0; k < road.count - 1; k++) assert.ok(Math.abs(road.level[k + 1] - road.level[k]) <= unit * .11 + 1e-4, `${road.id} climbs too steeply at point ${k}`);
      // Both ends sit at their waypoint's height, shared by every road there.
      const [a, b] = road.id.split('>');
      for (const [node, level] of [[a, road.level[0]], [b, road.level[road.count - 1]]]) {
        if (junctions.has(node)) assert.ok(Math.abs(junctions.get(node) - level) < 1e-4, `roads meet at ${node} at one height`);
        else junctions.set(node, level);
      }
    }
    // The first road leaves the start heading roughly north.
    assert.ok(world.roadAt(0, 0).d < 1 && Math.cos(world.startHeading) > .7);
  }
});

test('the land is cut and filled to each road, and rivers carve their valleys without cutting into roads beside them', () => {
  for (const world of worlds) {
    let worst = 0;
    for (const road of roadsOf(world)) for (let s = 150; s < road.length - 150; s += 25) {
      const p = world.alongRoad(road, s), here = world.roadAt(p.x, p.z);
      // Away from junctions, other roads, bridges and ramps.
      if (here.id !== road.id || here.od < 30 || here.approach || world.rampAt(p.x, p.z)) continue;
      worst = Math.max(worst, Math.abs(world.surface(p.x, p.z) - here.level));
    }
    assert.ok(worst < 1, `seed ${world.seed}: the ground strays ${worst.toFixed(2)} m from a road's level`);
  }
});

test('rivers run down from the hills to their seas, held in by their banks', () => {
  for (const world of worlds) {
    const rivers = world.riversNear(0, 0, RADIUS);
    assert.ok(rivers.length > 0, `seed ${world.seed} has rivers`);
    let inChannel = 0, sailable = 0;
    for (const river of rivers) {
      const sea = world.seasNear(river.points[river.count * 2 - 2], river.points[river.count * 2 - 1], 500).find(s => s.id === river.sea);
      assert.ok(Math.abs(river.level[river.count - 1] - (sea.level - .05)) < 1e-3, `${river.id} meets its sea's level`);
      for (let k = 0; k < river.count - 1; k++) {
        assert.ok(river.level[k + 1] <= river.level[k] + 1e-4, `${river.id} never flows uphill`);
        assert.ok(river.width[k + 1] >= river.width[k] - 1e-4, `${river.id} widens downstream`);
      }
      for (let k = 5; k < river.count - 5; k += 3) {
        const x = river.points[k * 2], z = river.points[k * 2 + 1], dx = river.points[k * 2 + 2] - x, dz = river.points[k * 2 + 3] - z, len = Math.hypot(dx, dz);
        const water = world.waterAt(x, z);
        if (water?.lake.name === 'THE RIVER') inChannel++;
        if (water?.depth > .9) sailable++;
        // Just beyond either bank the ground stands above the water.
        for (const side of [-1, 1]) {
          const off = river.width[k] / 2 + 3, bx = x - dz / len * off * side, bz = z + dx / len * off * side, here = world.riverAt(bx, bz);
          if (here?.id !== river.id || world.roadAt(bx, bz).d < 20 || world.lakeAt(bx, bz)) continue;
          assert.ok(world.groundSurface(bx, bz) > here.level, `${river.id} spills over its bank at ${bx.toFixed(0)}, ${bz.toFixed(0)}`);
        }
      }
    }
    assert.ok(inChannel > 40 && sailable > 30, `seed ${world.seed}: ${inChannel} channel samples, ${sailable} deep enough for the boat`);
  }
});

test('bridges carry roads over rivers, well clear of the water, with boats passing beneath', () => {
  for (const world of worlds) {
    const bridges = bridgesOf(world);
    assert.ok(bridges.length >= 3, `seed ${world.seed}: ${bridges.length} bridges`);
    for (const { road, bridge, unit } of bridges) {
      for (let k = bridge.i0; k <= bridge.i1; k++) {
        const river = world.riverAt(road.points[k * 2], road.points[k * 2 + 1]);
        if (river && river.d < river.width / 2) assert.ok(bridge.level >= river.level + 3.2 - 1e-3, `${road.id}: deck ${bridge.level} over water at ${river.level}`);
      }
      // No step anywhere from the approach, onto the deck and off again.
      let worst = 0;
      for (let s = (bridge.i0 - 12) * unit; s < (bridge.i1 + 12) * unit; s++) {
        const p = world.alongRoad(road, s), q = world.alongRoad(road, s + 1);
        worst = Math.max(worst, Math.abs(world.surface(q.x, q.z) - world.surface(p.x, p.z)));
      }
      assert.ok(worst < .2, `${road.id}: a ${worst.toFixed(2)} m step on the way over`);
      // Mid-span the car drives on the deck, while a boat on the river below stays on the water.
      const mid = world.alongRoad(road, (bridge.i0 + bridge.i1) / 2 * unit), river = world.riverAt(mid.x, mid.z);
      assert.ok(Math.abs(world.surface(mid.x, mid.z) - bridge.level) < 1e-3);
      assert.ok(world.surface(mid.x, mid.z, river.level) < river.level);
      assert.ok(world.waterAt(mid.x, mid.z)?.depth > 0, `${road.id}: the river runs on under the deck`);
    }
  }
});

test('a car at full speed crosses bridges on the deck without launching off the approaches', () => {
  for (const world of worlds) {
    const bridges = bridgesOf(world).filter(({ road, bridge }) => bridge.i0 > 30 && bridge.i1 < road.count - 30).slice(0, 3);
    assert.ok(bridges.length > 0);
    for (const { road, bridge, unit } of bridges) {
      // Start 300 m out, at top speed by the time the deck is reached.
      const start = world.alongRoad(road, (bridge.i0 - 30) * unit), car = createVehicle(world, start.x, start.z, start.heading);
      car.vx = Math.sin(start.heading) * 80; car.vz = Math.cos(start.heading) * 80;
      let onDeck = 0, highest = 0;
      for (let i = 0; i < Math.round(6 / FIXED_DT); i++) {
        // Steer along the road.
        const here = world.roadAt(car.x, car.z), side = (car.x - here.x) * Math.cos(here.heading) - (car.z - here.z) * Math.sin(here.heading);
        car.heading = here.heading - Math.max(-.3, Math.min(.3, side * .05));
        stepVehicle(car, { up: true }, world, []);
        const now = world.roadAt(car.x, car.z);
        if (now.approach !== bridge || now.d > 4) continue;
        if (now.bridge) { onDeck++; assert.ok(car.y >= now.level, `${road.id}: the car dropped through the deck`); }
        if (!car.grounded) highest = Math.max(highest, car.y - world.surface(car.x, car.z, car.y));
        assert.equal(car.boatMode, false);
      }
      assert.ok(onDeck > 20, `${road.id}: crossed the deck (${onDeck} steps)`);
      assert.ok(highest < 1, `${road.id}: left the road by ${highest.toFixed(2)} m`);
    }
  }
});

test('roads and rivers worked out a slice at a time match those worked out at once', () => {
  const sliced = createWorld(3); let calls = 0;
  while (!sliced.prepareRoads(0, 0, RADIUS, 2)) calls++;
  assert.ok(calls > 3, `spread over ${calls + 1} calls`);
  const strip = list => list.map(({ id, points, level, bridges }) => ({ id, points, level, bridges })).sort((a, b) => a.id < b.id ? -1 : 1);
  assert.deepEqual(strip(roadsOf(sliced)), strip(roadsOf(worlds[0])));
  const rivers = world => world.riversNear(0, 0, RADIUS).map(({ id, points, level }) => ({ id, points, level })).sort((a, b) => a.id < b.id ? -1 : 1);
  assert.deepEqual(rivers(sliced), rivers(worlds[0]));
});

test('road maps paint each road where the physics puts it', () => {
  const world = worlds[0], road = roadsOf(world).find(r => !r.bridges.length), size = 96, res = 128;
  const p = world.alongRoad(road, road.length / 2), x0 = Math.floor(p.x / size) * size, z0 = Math.floor(p.z / size) * size;
  const map = world.roadMap(x0, z0, size, res), texel = size / res;
  for (let j = 0; j < res; j += 7) for (let i = 0; i < res; i += 7) {
    const x = x0 + (i + .5) * texel, z = z0 + (j + .5) * texel, d = world.roadAt(x, z).d;
    // Distance to the road in 5 cm steps, out to 12.75 m.
    assert.ok(Math.abs(map[(j * res + i) * 4] * .05 - Math.min(d, 12.75)) < texel, `texel ${i}, ${j}: ${map[(j * res + i) * 4] * .05} m vs ${d} m`);
  }
});
