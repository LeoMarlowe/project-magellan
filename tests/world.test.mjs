import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createVehicle, stepVehicle, recoverVehicle, resolveObstacles, groundAt, featurePoint, featureLocal, FIXED_DT, CHUNK, GRID, SPEED_LIMIT, VARIANT } from '../world.mjs';
import { SNOW_LINE } from '../landforms.mjs';
const flat = { surface: () => 0, gradient: () => ({ x: 0, z: 0 }), roadAt: (x, z) => ({ d: 0, x, z }), props: () => [] };
function advance(car, input, world, seconds, obstacles = []) { for (let t = 0; t < Math.round(seconds / FIXED_DT); t++) stepVehicle(car, input, world, obstacles); }

test('same seed reproduces terrain, roads and props, independent of visit order', () => {
  const a = createWorld(483921), b = createWorld(483921);
  const coords = [[0, 0], [-500, 690], [1581, -731], [100000, -80000]];
  for (const [x, z] of coords.reverse()) { assert.equal(a.surface(x, z), b.surface(x, z)); assert.deepEqual(a.roadAt(x, z), b.roadAt(x, z)); }
  assert.deepEqual(a.props(-7, 18), b.props(-7, 18));
  assert.notEqual(a.height(850, 300), createWorld(123456).height(850, 300));
});
test('terrain agrees with the rendered triangle grid and has no chunk discontinuities', () => {
  const world = createWorld(483921);
  for (let x = -400; x < 400; x += GRID) for (let z = -400; z < 400; z += 20) {
    assert.equal(world.surface(x, z), world.height(x, z));
    const a = world.height(x, z), b = world.height(x + GRID, z), c = world.height(x, z + GRID);
    assert.ok(Math.abs(world.surface(x + 1, z + 1) - (a + (b - a) / 4 + (c - a) / 4)) < 1e-10);
  }
  for (let c = -25; c <= 25; c++) for (let i = 0; i < 20; i++) {
    const x = c * CHUNK, z = i * 67 - 300;
    assert.ok(Math.abs(world.surface(x - .0001, z) - world.surface(x + .0001, z)) < .001);
  }
});
test('landforms stay mostly drivable across seeds, with real cliffs, and no artificial spawn walls', () => {
  let maxSlope = 0;
  for (const seed of [1, 77, 12345, 483921, 999999, 82930]) {
    const world = createWorld(seed);
    let samples = 0, steep = 0;
    for (let x = -2400; x < 2400; x += 73) for (let z = -2400; z < 2400; z += 79) {
      const g = world.gradient(x, z), slope = Math.hypot(g.x, g.z);
      maxSlope = Math.max(maxSlope, slope); samples++; if (slope > 1) steep++;
    }
    // Mesa walls and mountain crags are steeper than 45°, but only in places.
    assert.ok(steep / samples < .05, `seed ${seed}: ${(steep / samples * 100).toFixed(1)}% of the ground is steeper than 45°`);
    const h = world.height(0, 0);
    assert.ok(Math.abs(world.height(1, 0) - h) < 1.1);
    // Open plains around the start.
    for (const [x, z] of [[300, 0], [0, 300], [-300, 0], [0, -300]]) assert.ok(world.mountainAt(x, z) === 0, `seed ${seed}: plains at the start`);
  }
  assert.ok(maxSlope > 1.5, `cliffs exist: steepest sampled slope ${maxSlope}`);
});

test('mountain ranges rise to snowy peaks a few hundred metres high, away from the start', () => {
  for (const seed of [3, 12345]) {
    const world = createWorld(seed);
    let peak = -Infinity, snowy = 0, mountains = 0, samples = 0;
    for (let x = -6000; x <= 6000; x += 120) for (let z = -6000; z <= 6000; z += 120) {
      const h = world.height(Math.round(x / 4) * 4, Math.round(z / 4) * 4); samples++;
      peak = Math.max(peak, h); if (h > SNOW_LINE) snowy++; if (world.mountainAt(x, z) > .5) mountains++;
    }
    assert.ok(peak > 300 && peak < 450, `seed ${seed}: peak ${peak} m, under the thin air`);
    assert.ok(snowy > 0 && snowy / samples < .05, `seed ${seed}: snow on the peaks only (${snowy})`);
    assert.ok(mountains / samples > .05 && mountains / samples < .35, `seed ${seed}: ranges cover ${(mountains / samples * 100).toFixed(0)}%`);
  }
});

test('steep climbs slow the car, and faces steeper than about 40 degrees cannot be climbed', () => {
  const top = grade => {
    const slope = { ...flat, roadAt: () => ({ d: 20 }), surface: (x, z) => z * grade, gradient: () => ({ x: 0, z: grade }) };
    const car = createVehicle(slope); let best = 0;
    for (let i = 0; i < 2400; i++) { stepVehicle(car, { up: true }, slope, []); best = Math.max(best, car.vz); }
    return { best: best * 3.6, final: car.vz * 3.6 };
  };
  const level = top(0).best, gentle = top(.15).best, steep = top(.5).best, wall = top(1);
  assert.ok(gentle > level * .95, `a gentle grade barely slows the car: ${gentle}`);
  assert.ok(steep < level * .7 && steep > 80, `a 27° climb is slow but possible: ${steep}`);
  assert.ok(wall.best < 30 && wall.final < 0, 'a 45° face cannot be climbed: the car slides back');
});
test('richer scenery leaves roads and ramp approaches clear and stays deterministic', () => {
  const world = createWorld(483921); let count = 0;
  for (let cx = -12; cx < 12; cx++) for (let cz = -12; cz < 12; cz++) {
    const props = world.props(cx, cz); count += props.length;
    for (const p of props) {
      assert.ok(world.roadAt(p.x, p.z).d >= 12); assert.ok(Math.hypot(p.x, p.z) >= 24); assert.notEqual(p.type, 'mountain');
      if (!['camp', 'lookout'].includes(p.type)) assert.ok(!world.reserved(p.x, p.z));
    }
  }
  assert.ok(count / 576 > 10 && count / 576 < 25, `average ${count / 576} props per chunk`);
});
test('Space jumps at rest, rises over two meters, and lands without bouncing or repeat jumping', () => {
  const car = createVehicle(flat); let maxY = car.y;
  for (let i = 0; i < 300; i++) { stepVehicle(car, { jump: true }, flat, []); maxY = Math.max(maxY, car.y); }
  assert.equal(car.jumps, 1); assert.ok(maxY > 2.2 && maxY < 2.5); assert.ok(car.grounded); assert.equal(car.y, .06);
  advance(car, {}, flat, .2); advance(car, { jump: true }, flat, .05); assert.equal(car.jumps, 2); assert.ok(!car.grounded);
});
test('jump buffering accepts a press just before touchdown', () => {
  const car = createVehicle(flat); stepVehicle(car, { jump: true }, flat, []);
  advance(car, {}, flat, .79); assert.ok(!car.grounded);
  advance(car, { jump: true }, flat, .4);
  assert.equal(car.jumps, 2); assert.ok(!car.grounded);
});
test('accelerate, brake, reverse, and steer respond with correct direction', () => {
  const car = createVehicle(flat); advance(car, { up: true }, flat, 4); assert.ok(car.speed > 30 && car.z > 75);
  advance(car, { down: true }, flat, 4); assert.ok(car.speed < -5);
  const left = createVehicle(flat), right = createVehicle(flat);
  advance(left, { up: true, left: true }, flat, 2); advance(right, { up: true, right: true }, flat, 2);
  assert.ok(left.x > 0 && right.x < 0); assert.ok(Math.abs(left.x + right.x) < 1e-8);
});
test('a jump preserves forward motion and drift allows more lateral slip', () => {
  const car = createVehicle(flat); advance(car, { up: true }, flat, 2); const before = car.z;
  advance(car, { up: true, jump: true }, flat, .4); assert.ok(car.z > before + 8 && car.y > 2);
  const grip = createVehicle(flat), drift = createVehicle(flat);
  grip.vz = drift.vz = 30;
  advance(grip, { left: true }, flat, .5); advance(drift, { left: true, brake: true }, flat, .5);
  const slip = c => Math.abs(c.vx * Math.cos(c.heading) - c.vz * Math.sin(c.heading));
  assert.ok(slip(drift) > slip(grip) * 1.5);
});
test('collisions resolve exact overlaps, slide along trunks, and respect jump height', () => {
  const o = { x: 0, z: 0, y: 0, h: 1.2, r: .3 };
  const car = createVehicle(flat); resolveObstacles(car, [o]); assert.ok(Math.hypot(car.x, car.z) >= 1.23);
  car.x = .8; car.z = -.4; car.vx = -10; car.vz = 12; resolveObstacles(car, [o]);
  assert.ok(car.vz > 1); assert.ok(Math.hypot(car.x, car.z) >= 1.23);
  car.x = car.z = 0; car.y = 2; resolveObstacles(car, [o]); assert.equal(car.x, 0); assert.equal(car.z, 0);
});
test('recover finds clear ground, stops the car and retains trip records', () => {
  const world = createWorld(483921), car = createVehicle(world, 340, -210);
  car.distance = 800; car.bestAir = 1.2; car.jumps = 4; car.vx = 40; car.y = -100;
  assert.ok(recoverVehicle(car, world)); assert.ok(car.grounded); assert.equal(car.vx, 0); assert.equal(car.distance, 800); assert.equal(car.bestAir, 1.2); assert.equal(car.jumps, 4);
  assert.equal(car.y, groundAt(world, car.x, car.z, car.heading).y);
});
test('highway cruising reaches 300 km/h, off-road pace stays lower, and downhill speed is bounded', () => {
  const car = createVehicle(flat); advance(car, { up: true }, flat, 20);
  assert.ok(car.speed * 3.6 > 295 && car.speed * 3.6 < 305);
  const offroad = { ...flat, roadAt: () => ({ d: 20 }) }, dirtCar = createVehicle(offroad);
  advance(dirtCar, { up: true }, offroad, 20);
  assert.ok(dirtCar.speed * 3.6 > 220 && dirtCar.speed * 3.6 < 245);
  car.vz = 100; stepVehicle(car, {}, flat, []); assert.ok(Math.hypot(car.vx, car.vz) <= SPEED_LIMIT);
});
test('ramps launch without Jump and land safely across three seeds', () => {
  for (const seed of [1, 483921, 792835]) {
    const world = createWorld(seed), ramp = world.starterRamp, start = featurePoint(ramp, 0, -35), car = createVehicle(world, start.x, start.z, ramp.heading);
    let sawAir = false, landed = false, maxClearance = 0;
    let obstacles = [], lastChunk = '';
    for (let i = 0; i < 900; i++) {
      const cx = Math.floor(car.x / CHUNK), cz = Math.floor(car.z / CHUNK), chunk = `${cx},${cz}`;
      if (chunk !== lastChunk) { obstacles = []; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) obstacles.push(...world.props(cx + dx, cz + dz)); lastChunk = chunk; }
      stepVehicle(car, { up: true }, world, obstacles);
      const local = featureLocal(ramp, car.x, car.z);
      if (local.along >= ramp.length && !car.grounded) { sawAir = true; maxClearance = Math.max(maxClearance, car.y - car.groundY); }
      if (sawAir && car.grounded) { landed = true; break; }
    }
    assert.equal(car.jumps, 0, 'no button jump or fake jump count');
    assert.ok(sawAir && landed, `launch and landing in seed ${seed}`);
    assert.ok(car.bestJump > 60 && maxClearance > 5, `seed ${seed}: ${car.bestJump} m / ${maxClearance} m clearance`);
    const best = car.bestJump; recoverVehicle(car, world); assert.equal(car.bestJump, best);
  }
});
test('ramps and landmarks regenerate across feature-cache eviction and negative cell seams', () => {
  const world = createWorld(592831), before = world.featuresNear(-210, 350);
  for (let i = 0; i < 300; i++) world.featuresNear(i * 500, -i * 300);
  assert.deepEqual(world.featuresNear(-210, 350), before);
  for (let i = -15; i <= 15; i++) for (const z of [-197, -10, 131]) {
    const x = i * 288;
    assert.ok(Math.abs(world.height(x - .0001, z) - world.height(x + .0001, z)) < .001);
  }
});
test('fixed steps produce the same result at 30, 60 and 144 rendering frames per second', () => {
  const results = [30, 60, 144].map(fps => {
    const car = createVehicle(flat); let acc = 0;
    for (let frame = 0; frame < fps * 5; frame++) { acc += 1 / fps; while (acc + 1e-10 >= FIXED_DT) { stepVehicle(car, { up: true, left: true }, flat, []); acc -= FIXED_DT; } }
    return car;
  });
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]);
});
test('long drives in all directions across multiple seeds keep progressing and stay above ground', () => {
  for (const seed of [1, 483921, 792835]) for (let direction = 0; direction < 8; direction++) {
    const world = createWorld(seed), car = createVehicle(world, 0, 0, direction * Math.PI / 4);
    for (let i = 0; i < 7200; i++) {
      stepVehicle(car, { up: true, jump: i % 700 < 4 }, world, []);
      assert.ok(Number.isFinite(car.y + car.x + car.z));
      assert.ok(car.y >= car.groundY - 1e-9);
    }
    assert.ok(car.distance > 1700, `seed ${seed}, direction ${direction}: ${car.distance}`);
    assert.ok(Math.hypot(car.x, car.z) > 1500);
  }
});

test('sand regions are continuous, repeatable, and absent above the snow line', () => {
  const world = createWorld(100003), repeat = createWorld(100003);
  let desert = 0, grass = 0, snow = 0;
  for (let x = -4000; x <= 4000; x += 160) for (let z = -4000; z <= 4000; z += 160) {
    const amount = world.desertAt(x, z);
    assert.equal(amount, repeat.desertAt(x, z));
    assert.ok(amount >= 0 && amount <= 1);
    assert.ok(Math.abs(amount - world.desertAt(x + .001, z)) < .001);
    if (amount > .9) desert++;
    if (amount < .1) grass++;
    if (world.height(x, z) >= SNOW_LINE) { snow++; assert.equal(amount, 0); }
  }
  assert.ok(desert > 100 && grass > 100 && snow > 0, 'all three regions coexist');
});

test('cacti grow on sand, preserve clear routes, and replace grassland vegetation', () => {
  const world = createWorld(100003); let cacti = 0;
  for (let cx = -5; cx <= 5; cx++) for (let cz = -5; cz <= 5; cz++) {
    const props = world.props(cx, cz);
    assert.deepEqual(props, createWorld(100003).props(cx, cz));
    for (const prop of props) {
      if (prop.type === 'cactus') {
        cacti++;
        assert.ok(world.desertAt(prop.x, prop.z) > .55);
        assert.ok(world.roadAt(prop.x, prop.z).d >= 12 && !world.reserved(prop.x, prop.z));
        assert.ok(prop.r > 0 && prop.h > 0);
      }
      // On sand: no trees, and only dry desert scrub for bushes.
      if (world.desertAt(prop.x, prop.z) > .55) assert.ok(prop.type !== 'tree' && (prop.type !== 'bush' || prop.variant === VARIANT.bush.desert), `${prop.type} ${prop.variant} on sand`);
    }
  }
  assert.ok(cacti > 100);
});

test('dense recovery evaluates each chunk only once per attempt', () => {
  const calls = new Map();
  const blocked = { ...flat, gradient: () => ({ x: 1, z: 1 }), props: (cx, cz) => { const key = `${cx},${cz}`; calls.set(key, (calls.get(key) || 0) + 1); return []; } };
  const car = createVehicle(flat), original = { ...car };
  assert.equal(recoverVehicle(car, blocked), false);
  assert.equal(calls.size, 16); assert.ok([...calls.values()].every(count => count === 1)); assert.deepEqual(car, original);
  recoverVehicle(car, blocked); assert.ok([...calls.values()].every(count => count === 2), 'cache is limited to each recovery attempt');
});

test('high-speed impacts shatter scenery once, preserve momentum, and persist on revisits', () => {
  for (const type of ['cactus', 'tree', 'rock', 'boulder']) {
    const world = createWorld(1), car = createVehicle(flat, 0, -1);
    const prop = { id: 'test-prop', type, x: 0, z: 0, y: 0, h: 6, size: 1, r: type === 'rock' ? 0 : .5 };
    car.vz = 40; resolveObstacles(car, [prop], world);
    assert.equal(car.smashed, 1); assert.equal(world.brokenProps.has(prop.id), true);
    assert.ok(car.vz > 30); assert.equal(car.z, -1, 'breakage does not push the car away');
    resolveObstacles(car, [{ ...prop }], world);
    assert.equal(world.drainBreakEvents().length, 1); assert.equal(car.smashed, 1);
  }
  const world = createWorld(1), prop = world.props(0, 0)[0];
  world.breakProp(prop, 0, 40);
  assert.ok(!world.props(0, 0).some(p => p.id === prop.id));
  assert.ok(createWorld(1).props(0, 0).some(p => p.id === prop.id), 'a new world restores scenery');
});

test('slow, glancing, and above-canopy impacts do not break scenery', () => {
  const prop = { id: 'tree', type: 'tree', x: 0, z: 0, y: 0, h: 6, size: 1, r: .5 };
  for (const [vx, vz, y] of [[0, 10, .06], [40, 1, .06], [0, 40, 8]]) {
    const world = createWorld(1), car = createVehicle(flat, 0, -1); Object.assign(car, { vx, vz, y });
    resolveObstacles(car, [prop], world); assert.equal(car.smashed, 0); assert.equal(world.brokenProps.size, 0);
  }
});

test('twisted ramps bank the rendered terrain and launch a roll with safe landing', () => {
  for (const seed of [1, 77, 100003, 483921]) {
    const world = createWorld(seed), ramp = world.twistRamp, p = featurePoint(ramp, 0, -35);
    const left = featurePoint(ramp, -4, ramp.length), right = featurePoint(ramp, 4, ramp.length);
    assert.ok(Math.abs(world.rampLift(ramp, left.x, left.z) - world.rampLift(ramp, right.x, right.z)) > 5);
    const car = createVehicle(world, p.x, p.z, ramp.heading); let rotation = 0;
    for (let i = 0; i < 960; i++) { stepVehicle(car, { up: true }, world, []); rotation = Math.max(rotation, car.airRoll); assert.ok(car.y >= car.groundY); }
    assert.ok(rotation > Math.PI * 1.7, `seed ${seed} rotates through ${rotation} radians`);
    assert.ok(car.landings > 0); assert.equal(car.rollVelocity, 0); assert.ok(Math.abs(car.roll) < .6);
    recoverVehicle(car, world); assert.equal(car.rollVelocity, 0); assert.equal(car.airRoll, 0);
  }
});

test('jumping from an upper twisted deck inherits its handedness only at speed', () => {
  for (const twist of [-1, 1]) for (const speed of [5, 35]) {
    const world = createWorld(1), ramp = world.twistRamp; ramp.twist = twist;
    const p = featurePoint(ramp, 0, ramp.length * .7), car = createVehicle(world, p.x, p.z, ramp.heading);
    car.vz = speed; stepVehicle(car, { jump: true }, world, []);
    assert.equal(car.grounded, false);
    assert.equal(Math.sign(car.rollVelocity), speed > 12 ? twist : 0);
  }
});

test('ramp backs and sides retain the same ballistic motion as identical unmarked terrain', () => {
  for (const degrees of [90, 135, 180, 225, 270]) {
    const world = createWorld(1), ramp = world.starterRamp;
    const unmarked = { ...world, rampAt: () => null };
    const heading = ramp.heading + degrees * Math.PI / 180, target = featurePoint(ramp, 0, ramp.length * .85);
    const car = createVehicle(world, target.x - Math.sin(heading) * 18, target.z - Math.cos(heading) * 18, heading);
    car.vx = Math.sin(heading) * 40; car.vz = Math.cos(heading) * 40;
    const reference = { ...car }; let maxClearance = 0, enteredRamp = false, launched = false, landed = false;
    for (let i = 0; i < 960; i++) {
      stepVehicle(car, { up: true }, world, []); stepVehicle(reference, { up: true }, unmarked, []);
      assert.equal(car.grounded, reference.grounded, `${degrees}° ramp metadata must not glue the car down at tick ${i}`);
      assert.ok(Math.abs(car.y - reference.y) < 1e-8 && Math.abs(car.vy - reference.vy) < 1e-8);
      const local = featureLocal(ramp, car.x, car.z);
      if (local.along > 0 && local.along < ramp.length + ramp.back && Math.abs(local.across) < ramp.width / 2 + 7) enteredRamp = true;
      if (enteredRamp && !car.grounded && car.y - car.groundY > 1) launched = true;
      if (launched) { maxClearance = Math.max(maxClearance, car.y - car.groundY); if (car.grounded) { landed = true; break; } }
    }
    assert.ok(enteredRamp && launched && landed && maxClearance > 2, `approach ${degrees}° launches and lands`);
  }
});

test('oblique front approaches launch and slow ramp driving stays supported', () => {
  for (const degrees of [-45, 45]) {
    const world = createWorld(1), ramp = world.starterRamp, heading = ramp.heading + degrees * Math.PI / 180;
    const target = featurePoint(ramp, 0, ramp.length * .85);
    const car = createVehicle(world, target.x - Math.sin(heading) * 18, target.z - Math.cos(heading) * 18, heading);
    car.vx = Math.sin(heading) * 40; car.vz = Math.cos(heading) * 40;
    let airborne = false;
    for (let i = 0; i < 600; i++) { stepVehicle(car, { up: true }, world, []); airborne ||= car.y - car.groundY > 2; }
    // The right-hand approach now lands in Mirror Lake and deploys its hull.
    assert.ok(airborne && (car.landings > 0 || car.floating));
  }
  const world = createWorld(1), ramp = world.starterRamp, p = featurePoint(ramp, 0, ramp.length - 3);
  const car = createVehicle(world, p.x, p.z, ramp.heading + Math.PI); car.vz = -3;
  for (let i = 0; i < 60; i++) { stepVehicle(car, {}, world, []); assert.equal(car.grounded, true); }
});

test('ramps launch from the back, the sides and odd angles instead of holding the car down', () => {
  const world = createWorld(1);
  for (const ramp of [world.starterRamp, world.twistRamp]) {
    const target = featurePoint(ramp, 0, ramp.length * .7);
    for (const offset of [Math.PI, Math.PI * .8, -Math.PI * .8, Math.PI / 2, -Math.PI / 2, Math.PI / 3]) for (const speed of [18, 26, 40]) {
      const heading = ramp.heading + offset;
      const car = createVehicle(world, target.x - Math.sin(heading) * 30, target.z - Math.cos(heading) * 30, heading);
      car.vx = Math.sin(heading) * speed; car.vz = Math.cos(heading) * speed; car.speed = speed;
      // Climbing an embankment builds upward speed; leaving its top must keep
      // it, rather than the ground soaking it up and holding the car down.
      let climbing = 0, launch = 0, peak = 0;
      for (let i = 0; i < 120 * 2.5; i++) {
        stepVehicle(car, { up: true }, world, []);
        const p = featureLocal(ramp, car.x, car.z);
        if (!(p.along > -2 && p.along < ramp.length + ramp.back + 2 && Math.abs(p.across) < ramp.width / 2 + 9)) continue;
        if (car.grounded) climbing = Math.max(climbing, car.vy); else { launch = Math.max(launch, car.vy); peak = Math.max(peak, car.y - car.groundY); }
      }
      const label = `${ramp.id} from ${(offset * 180 / Math.PI).toFixed(0)}° at ${speed} m/s`;
      assert.ok(peak > 1.5, `${label} cleared only ${peak.toFixed(2)} m`);
      assert.ok(launch > climbing * .6, `${label} left at ${launch.toFixed(1)} m/s after climbing at ${climbing.toFixed(1)} m/s`);
    }
  }
});

test('a car leaving slanted ground keeps its tilt in the air and settles once it lands', () => {
  const world = createWorld(3), car = createVehicle(world);
  Object.assign(car, { roll: .3, pitch: -.2, grounded: false, vy: 5, vx: 0, vz: 15, airtime: 0, landLock: 0 });
  car.y = world.surface(car.x, car.z) + 2;
  for (let i = 0; i < Math.round(.25 / FIXED_DT); i++) stepVehicle(car, {}, world, []);
  assert.equal(car.grounded, false);
  assert.ok(car.roll > .25, `roll kept: ${car.roll}`); assert.ok(car.pitch < -.15, `pitch kept: ${car.pitch}`);
  for (let i = 0; i < Math.round(2 / FIXED_DT) && !car.grounded; i++) stepVehicle(car, {}, world, []);
  for (let i = 0; i < Math.round(.5 / FIXED_DT); i++) stepVehicle(car, {}, world, []);
  assert.equal(car.grounded, true);
  assert.ok(Math.abs(car.roll - groundAt(world, car.x, car.z, car.heading).roll) < .05, 'settled onto the ground');
});

test('a jump made mid-crest leaves no stored gap to relaunch the car after landing', () => {
  const world = createWorld(3);
  const flat = { ...world, height: () => 0, surface: () => 0, gradient: () => ({ x: 0, z: 0 }), rampAt: () => null, roadAt: () => ({ d: 0 }), waterAt: () => null, featuresNear: () => [] };
  const car = createVehicle(flat, 0, 0, 0);
  Object.assign(car, { vz: 30, speed: 30, y: 0, groundY: 0, grounded: true, shadow: .02, shadowVy: 6 }); // just short of separating
  stepVehicle(car, { jump: true }, flat, []);
  let landed = false;
  for (let i = 0; i < Math.round(3 / FIXED_DT); i++) {
    const was = car.grounded;
    stepVehicle(car, {}, flat, []);
    if (car.grounded) landed = true;
    assert.ok(!(landed && was && !car.grounded), 'relaunched itself on flat ground');
  }
  assert.ok(landed); assert.equal(car.jumps, 1);
});
