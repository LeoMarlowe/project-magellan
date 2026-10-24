import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createVehicle, stepVehicle, FIXED_DT, CHUNK, ROAD_HALF } from '../world.mjs';
import { createTerrain } from '../terrain.mjs';
import { buildRoadside } from '../roadside-data.mjs';

// Two seeds' roads and rivers within 3 km of the start, worked out once.
const RADIUS = 3000;
const worlds = [3, 11].map(seed => { const world = createWorld(seed); world.prepareRoads(0, 0, RADIUS, Infinity); return world; });
const roadsOf = world => world.roadsNear(0, 0, RADIUS), networkOf = world => world.roadsNear(0, 0, RADIUS, true);
const bridgesOf = world => roadsOf(world).flatMap(road => road.bridges.map(bridge => ({ road, bridge, unit: road.length / (road.count - 1) })));

test('roads follow the land: evenly spaced points, an 11% grade at most, and junctions that meet', () => {
  for (const world of worlds) {
    const roads = networkOf(world), junctions = new Map();
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
      for (let s = (bridge.i0 - 8) * unit; s < (bridge.i1 + 8) * unit; s++) {
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
  const world = worlds[0], road = networkOf(world).find(r => !r.bridges.length), size = 96, res = 128;
  const p = world.alongRoad(road, road.length / 2), x0 = Math.floor(p.x / size) * size, z0 = Math.floor(p.z / size) * size;
  const { map } = world.roadMap(x0, z0, size, res), texel = size / res;
  for (let j = 0; j < res; j += 7) for (let i = 0; i < res; i += 7) {
    const x = x0 + (i + .5) * texel, z = z0 + (j + .5) * texel, d = world.roadAt(x, z).d;
    // Distance to the road in 5 cm steps, out to 12.75 m.
    assert.ok(Math.abs(map[(j * res + i) * 4] * .05 - Math.min(d, 12.75)) < texel, `texel ${i}, ${j}: ${map[(j * res + i) * 4] * .05} m vs ${d} m`);
  }
});

test('junctions: a main road through each, and side roads that stop clear of it', () => {
  for (const world of worlds) {
    const seen = new Set(); let junctions = 0, sides = 0;
    for (const road of roadsOf(world)) for (const id of road.id.split('>')) {
      if (seen.has(id)) continue; seen.add(id);
      const junction = world.junctionAt(id);
      if (!junction) continue;
      junctions++;
      for (const arm of junction.arms) {
        if (arm.main) continue;
        sides++;
        // Across the whole incoming lane, the stop line lies on this road alone.
        const s = arm.start ? arm.setback : arm.e.length - arm.setback;
        for (const lateral of [.3, 2, 4]) {
          const p = world.alongRoad(arm.e, s, (arm.start ? 1 : -1) * lateral), here = world.roadAt(p.x, p.z);
          assert.ok(here.id === arm.e.id && here.od > ROAD_HALF, `${id}: the stop line on ${arm.e.id} is clear of the other roads`);
        }
      }
    }
    assert.ok(junctions > 15 && sides > 30, `seed ${world.seed}: ${junctions} junctions, ${sides} side roads`);
  }
});

test('the centre line is solid on about a fifth of the road, and road maps know which side of it a point lies', () => {
  for (const world of worlds) {
    let solid = 0, total = 0;
    for (const road of networkOf(world)) for (let k = 0; k < road.count; k++) { solid += road.solid[k]; total++; }
    assert.ok(solid / total > .1 && solid / total < .4, `seed ${world.seed}: ${(solid / total * 100).toFixed(0)}% solid`);
    const road = networkOf(world).find(r => !r.bridges.length);
    for (const side of [-1, 1]) {
      const p = world.alongRoad(road, road.length / 2, side), x0 = Math.floor(p.x / CHUNK) * CHUNK, z0 = Math.floor(p.z / CHUNK) * CHUNK;
      const { map, info } = world.roadMap(x0, z0, CHUNK, 128, true), q = (Math.floor((p.z - z0) / .75) * 128 + Math.floor((p.x - x0) / .75)) * 4;
      assert.ok(Math.abs((map[q + 3] / 255 * 2 - 1) * 4 - side) < .2, `a point 1 m ${side > 0 ? 'left' : 'right'} of the centre line`);
      // Mid-road: no junction near, and not a side road's approach.
      assert.equal(info[q + 2], 255); assert.equal(info[q + 3], 128);
    }
    assert.ok(world.roadMap(0, 0, 384, 128, false).info, 'far tiles have a detail map too (road classes)');
  }
});

test('roadside furniture stands beside the roads, belongs to its own chunk, and is the same every time', () => {
  for (const world of worlds) {
    const terrain = createTerrain(world); let rails = 0;
    for (let cx = -8; cx <= 8; cx++) for (let cz = -8; cz <= 8; cz++) {
      const { mesh, signs, obstacles } = buildRoadside(world, terrain, cx, cz);
      // Each sign is its own piece, kept relative to its foot.
      for (const sign of signs?.list || []) {
        assert.ok(obstacles.some(o => o.type === 'sign' && o.id === sign.id));
        for (let v = sign.start; v < sign.start + sign.count; v++) assert.ok(Math.hypot(signs.position[v * 3], signs.position[v * 3 + 2]) < 2.5 && signs.position[v * 3 + 1] > -.5, `${sign.id} drawn around its foot`);
      }
      if (mesh) {
        const vertices = mesh.position.length / 3;
        for (const name of ['normal', 'color']) assert.equal(mesh[name].length, vertices * 3);
        for (const name of ['retro', 'groundDelta']) assert.equal(mesh[name].length, vertices);
      }
      for (const o of obstacles) {
        assert.ok(Math.floor(o.x / CHUNK) === cx && Math.floor(o.z / CHUNK) === cz, 'each piece in the chunk it stands in');
        const d = world.roadAt(o.x, o.z).d;
        if (o.type === 'rail') { rails++; assert.ok(d > 5.8 && d < 6.4, `a guardrail ${d} m from the road`); }
      }
    }
    assert.ok(rails > 50, `seed ${world.seed}: ${rails} guardrail pieces`);
    const again = createWorld(world.seed), first = buildRoadside(world, terrain, 0, 0), second = buildRoadside(again, createTerrain(again), 0, 0);
    assert.deepEqual(second.obstacles, first.obstacles); assert.deepEqual(second.mesh?.position, first.mesh?.position);
  }
});

test('a car driven into a guardrail is stopped by it', () => {
  const world = worlds[0], terrain = createTerrain(world), obstacles = [];
  for (let cx = -8; cx <= 8 && !obstacles.some(o => o.type === 'rail'); cx++) for (let cz = -8; cz <= 8; cz++) obstacles.push(...buildRoadside(world, terrain, cx, cz).obstacles);
  const rail = obstacles.find(o => o.type === 'rail'), road = world.roadAt(rail.x, rail.z), heading = Math.atan2(rail.x - road.x, rail.z - road.z);
  const car = createVehicle(world, road.x - Math.sin(heading) * 3, road.z - Math.cos(heading) * 3, heading);
  car.vx = Math.sin(heading) * 25; car.vz = Math.cos(heading) * 25;
  for (let i = 0; i < 120; i++) stepVehicle(car, { up: true }, world, obstacles);
  assert.ok(Math.hypot(car.x - road.x, car.z - road.z) < Math.hypot(rail.x - road.x, rail.z - road.z) - .9, 'held on the road side of the rail');
});

test('a car knocks a sign over and drives on', () => {
  const world = createWorld(3), terrain = createTerrain(world), obstacles = [];
  world.prepareRoads(0, 0, 1000, Infinity);
  for (let cx = -2; cx <= 1; cx++) for (let cz = -2; cz <= 1; cz++) obstacles.push(...buildRoadside(world, terrain, cx, cz).obstacles);
  const signs = obstacles.filter(o => o.type === 'sign');
  assert.ok(signs.length >= 3, 'stop signs and a fingerpost at the first junction');
  for (const sign of signs) {
    const heading = Math.atan2(sign.x, sign.z), car = createVehicle(world, sign.x - Math.sin(heading) * 25, sign.z - Math.cos(heading) * 25, heading);
    car.vx = Math.sin(heading) * 15; car.vz = Math.cos(heading) * 15;
    for (let i = 0; i < 240; i++) stepVehicle(car, {}, world, obstacles);
    assert.ok(world.brokenProps.has(sign.id), `${sign.id} knocked over`);
    assert.ok(Math.hypot(car.x - sign.x, car.z - sign.z) > 5, 'the car carries on past it');
  }
  assert.equal(world.drainBreakEvents().filter(e => e.type === 'sign').length, signs.length);
});

test('lanes lead off the roads to camps, lookouts and lakes, joining at a T and ending there', () => {
  for (const world of worlds) {
    const spurs = roadsOf(world).filter(road => road.spur && !road.spur.track);
    assert.ok(spurs.length > 20, `seed ${world.seed}: ${spurs.length} lanes`);
    for (const spur of spurs) {
      const [start, end] = world.roadEnds(spur);
      assert.ok(start && !start.main && start.setback > ROAD_HALF && end === null, `${spur.id}: a T junction where it leaves its road, a dead end at the other`);
      // It starts on its road, at its road's height.
      const parent = networkOf(world).find(e => e.id === spur.spur.parent), p = world.alongRoad(parent, spur.spur.s);
      const f = spur.spur.s / parent.length * (parent.count - 1), k = Math.min(Math.floor(f), parent.count - 2);
      assert.ok(Math.hypot(p.x - spur.points[0], p.z - spur.points[1]) < .5 && Math.abs(spur.level[0] - (parent.level[k] + (parent.level[k + 1] - parent.level[k]) * (f - k))) < .05, `${spur.id} leaves its road`);
      for (let k = 1; k < spur.count; k++) assert.ok(Math.abs(spur.level[k] - spur.level[k - 1]) <= spur.length / (spur.count - 1) * .15, `${spur.id} stays drivable`);
      const x = spur.points[spur.count * 2 - 2], z = spur.points[spur.count * 2 - 1];
      if (spur.spur.slipway) assert.ok(world.waterAt(x, z), `${spur.id} runs down into the water`);
      else assert.ok(world.featuresNear(x, z, 40).some(f => ['camp', 'lookout'].includes(f.type) && Math.hypot(f.x - x, f.z - z) < 14), `${spur.id} ends at its site`);
    }
  }
});

test('now and then a junction is a roundabout: a ring round a bare island, every road giving way', () => {
  let rings = 0;
  for (const world of worlds) for (const ring of roadsOf(world).filter(road => road.ring)) {
    rings++;
    const junction = ring.ring;
    assert.ok(junction.arms.length >= 4 && junction.arms.every(arm => !arm.main && arm.ring && arm.setback >= 16 + ROAD_HALF), `${ring.id}: every road gives way outside the ring`);
    assert.ok(Math.hypot(ring.points[0] - ring.points[ring.count * 2 - 2], ring.points[1] - ring.points[ring.count * 2 - 1]) < .01, 'the ring closes');
    // The island has no asphalt painted on it.
    const x0 = Math.floor(junction.x / CHUNK) * CHUNK, z0 = Math.floor(junction.z / CHUNK) * CHUNK, { map } = world.roadMap(x0, z0, CHUNK, 128, true);
    const q = (Math.floor((junction.z - z0) / .75) * 128 + Math.floor((junction.x - x0) / .75)) * 4;
    assert.ok(map[q] * .05 > ROAD_HALF + 3, `${ring.id}: a bare island`);
  }
  assert.ok(rings > 0, 'some roundabouts near the start');
});

test('roads climb into the mountains in hairpin bends, never steeper than 11%', () => {
  let mountain = 0, hairpins = 0;
  for (const seed of [3, 12345]) {
    const world = createWorld(seed); world.prepareRoads(0, 0, 4000, Infinity);
    for (const road of world.roadsNear(0, 0, 4000, true)) {
      const unit = road.length / (road.count - 1);
      for (let k = 0; k < road.count; k++) {
        if (world.mountainAt(road.points[k * 2], road.points[k * 2 + 1]) > .35) mountain++;
        if (k && Math.abs(road.curve[k]) > 1 / 35 && Math.abs(road.curve[k - 1]) <= 1 / 35) hairpins++;
        if (k) assert.ok(Math.abs(road.level[k] - road.level[k - 1]) <= unit * .11 + 1e-4, `${road.id} climbs too steeply`);
      }
    }
  }
  assert.ok(mountain > 200 && hairpins > 5, `${mountain} road points in the mountains, ${hairpins} hairpins`);
});

test('highways, country roads and dirt tracks: each kind as wide as it should be', () => {
  for (const world of worlds) {
    const kinds = {};
    for (const road of networkOf(world)) {
      kinds[road.kind] = (kinds[road.kind] || 0) + road.length;
      const unit = road.length / (road.count - 1);
      if (road.kind === 'highway') for (let k = 1; k < road.count; k++) assert.ok(Math.abs(road.level[k] - road.level[k - 1]) <= unit * .075 + 1e-4, `${road.id}: a highway stays gentle`);
    }
    assert.ok(kinds.highway > 10000 && kinds.road > 20000 && kinds.dirt > 5000, `seed ${world.seed}: ${JSON.stringify(kinds)}`);
    // Each road's edge is ROAD_HALF from the line, by its own width: a point 6 m out is on a highway, off a dirt track.
    const highway = networkOf(world).find(r => r.kind === 'highway' && !r.bridges.length), track = networkOf(world).find(r => r.kind === 'dirt' && !r.bridges.length);
    for (const [road, inside] of [[highway, true], [track, false]]) {
      const p = world.alongRoad(road, road.length / 2, 6), here = world.roadAt(p.x, p.z);
      if (here.id === road.id) assert.equal(here.d < ROAD_HALF, inside, `${road.kind} at 6 m`);
    }
  }
});

test('mountain tracks climb from the roads to the high tops, some above the snow line', () => {
  let tracks = 0, highest = 0;
  for (const seed of [3, 12345]) {
    const world = createWorld(seed); world.prepareRoads(0, 0, 4000, Infinity);
    for (const track of world.roadsNear(0, 0, 4000).filter(road => road.spur?.track)) {
      tracks++; highest = Math.max(highest, ...track.level);
      assert.equal(track.kind, 'dirt');
      const unit = track.length / (track.count - 1);
      for (let k = 1; k < track.count; k++) assert.ok(Math.abs(track.level[k] - track.level[k - 1]) <= unit * .17 + 1e-4, `${track.id} stays drivable`);
      assert.ok(world.roadEnds(track)[0] && world.roadEnds(track)[1] === null, `${track.id}: a T junction at the road, a dead end at the top`);
    }
  }
  assert.ok(tracks >= 3 && highest > 250, `${tracks} tracks, the highest reaching ${highest.toFixed(0)} m`);
});

test('dirt is slower and looser than tarmac', () => {
  const run = kind => {
    const world = { surface: () => 0, gradient: () => ({ x: 0, z: 0 }), roadAt: (x, z) => ({ d: 0, x, z, kind }), props: () => [] };
    const car = createVehicle(world); for (let i = 0; i < 2400; i++) stepVehicle(car, { up: true }, world, []);
    const top = car.speed; car.steer = 0;
    for (let i = 0; i < 60; i++) stepVehicle(car, { up: true, left: true }, world, []);
    return { top, slip: Math.abs(car.vx * Math.cos(car.heading) - car.vz * Math.sin(car.heading)), dirt: car.onDirt };
  };
  const tarmac = run('road'), dirt = run('dirt');
  assert.ok(dirt.dirt && !tarmac.dirt);
  assert.ok(dirt.top < tarmac.top * .95 && dirt.top > tarmac.top * .7, `dirt ${dirt.top * 3.6} km/h, tarmac ${tarmac.top * 3.6} km/h`);
  assert.ok(dirt.slip > tarmac.slip, 'the car slides more on dirt');
});
