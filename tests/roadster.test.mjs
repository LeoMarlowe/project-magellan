import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createVehicle, stepVehicle, recoverVehicle, FIXED_DT, SPEED_LIMIT } from '../world.mjs';
import { ROADSTER, SUCTION, AERO, AIR_BRAKE, MPH60, hoverWorld } from '../roadster-motion.mjs';
const flat = { surface: () => 0, gradient: () => ({ x: 0, z: 0 }), roadAt: (x, z) => ({ d: 0, x, z }), props: () => [] };
const grass = { ...flat, roadAt: () => ({ d: 20 }) }, dirt = { ...flat, roadAt: () => ({ d: 0, kind: 'dirt' }) };
const roadster = (world = flat, x = 0, z = 0, heading = 0) => createVehicle(world, x, z, heading, 'roadster');
function advance(car, input, world, seconds) { for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) stepVehicle(car, typeof input === 'function' ? input(i * FIXED_DT) : input, world, []); }
// Seconds from rest to a speed (m/s), driving straight ahead (interpolated
// within the step that crosses it).
function timeTo(speed, input, world = flat) {
  const car = roadster(world);
  for (let i = 1; i < 120 * 30; i++) {
    const before = car.speed; stepVehicle(car, input, world, []);
    if (car.speed >= speed) return (i - 1 + (speed - before) / (car.speed - before)) * FIXED_DT;
  }
  return Infinity;
}

test('the Roadster is its own kind: no boat, no wings, a full tank of gas', () => {
  const car = roadster(), atlas = createVehicle(flat);
  assert.equal(car.kind, 'roadster'); assert.equal(atlas.kind, 'atlas');
  assert.equal(car.gas, 1); assert.equal(atlas.gas, undefined);
  assert.equal(car.wheelRadius, ROADSTER.wheelRadius);
  advance(car, { up: true, lift: true }, flat, 1);
  assert.equal(car.flightMode, false); assert.equal(car.flight, 0); assert.equal(car.transform, 0);
});

test('acceleration and top speed come from the published figures', () => {
  // 0–60 mph: under 1.6 s on the tyres (with the suction fans), under 0.59 s with the thrusters.
  const tyres = timeTo(MPH60, { up: true }), boosted = timeTo(MPH60, { up: true, boost: true });
  assert.ok(tyres > 1.5 && tyres <= 1.6, `tyres ${tyres}`);
  assert.ok(boosted > .5 && boosted < .59, `boosted ${boosted}`);
  // Power-limited above ~125 km/h: 1 MW over 1,700 kg.
  const crossover = ROADSTER.power / ROADSTER.launch;
  assert.ok(Math.abs(ROADSTER.power - 588.2) < .1 && crossover * 3.6 > 120 && crossover * 3.6 < 130);
  // Over 230 mph on tarmac, where power meets drag.
  const car = roadster(); advance(car, { up: true }, flat, 40);
  assert.ok(car.speed * 3.6 > 365 && car.speed * 3.6 <= 370, `${car.speed * 3.6} km/h`);
  assert.ok(Math.abs(ROADSTER.power / ROADSTER.topSpeed - (AERO * ROADSTER.topSpeed ** 2 + .01 * ROADSTER.topSpeed)) < 1e-9);
  // A low supercar is slower off the tarmac than the ATLAS: dirt, then grass.
  const onDirt = roadster(dirt), onGrass = roadster(grass);
  advance(onDirt, { up: true }, dirt, 40); advance(onGrass, { up: true }, grass, 40);
  assert.ok(onDirt.speed * 3.6 > 240 && onDirt.speed * 3.6 < 260, `dirt ${onDirt.speed * 3.6}`);
  assert.ok(onGrass.speed * 3.6 > 145 && onGrass.speed * 3.6 < 185, `grass ${onGrass.speed * 3.6}`);
  // Braking and reverse behave as the ATLAS's do.
  advance(car, { down: true }, flat, 6); assert.ok(car.speed < -5);
});

test('the boost lasts one 5.5 s tank, never passes 250 mph, and refills on the road', () => {
  const car = roadster(); advance(car, { up: true }, flat, 40);
  const cruise = car.speed;
  let peak = 0;
  advance(car, t => { peak = Math.max(peak, Math.hypot(car.vx, car.vz)); return { up: true, boost: true }; }, flat, 7);
  assert.ok(peak > cruise + 5 && peak <= ROADSTER.speedLimit + 1e-9, `peak ${peak * 3.6}`);
  assert.ok(ROADSTER.speedLimit > SPEED_LIMIT && Math.abs(ROADSTER.speedLimit * 3.6 / 1.609344 - 249.8) < .1);
  assert.equal(car.gas, 0); assert.ok(Math.abs(car.boostTime - ROADSTER.tank) < .02);
  assert.equal(car.boost, 0, 'an empty tank stops the boost');
  // Held on empty, nothing refills; let go and it refills while driving.
  advance(car, { up: true, boost: true }, flat, 2); assert.equal(car.gas, 0);
  advance(car, { up: true }, flat, ROADSTER.refill / 2); assert.ok(Math.abs(car.gas - .5) < .01);
  advance(car, { up: true }, flat, ROADSTER.refill); assert.equal(car.gas, 1);
  // Both groups at once drain twice as fast.
  const both = roadster(); advance(both, { boost: true, lift: true }, flat, 1);
  assert.ok(Math.abs(both.gas - (1 - 2 / ROADSTER.tank)) < .01);
});

test('held F lifts off, settles into a 5 m hover, and comes down once the gas is gone', () => {
  const car = roadster();
  let peak = 0, settled = [];
  for (let i = 0; i < 120 * 9; i++) {
    stepVehicle(car, { lift: true }, flat, []);
    const t = (i + 1) * FIXED_DT, height = car.y - car.groundY;
    peak = Math.max(peak, height);
    if (t > 2.5 && t < 5.3) settled.push(height);
    if (t < 5.4) { assert.ok(!car.grounded); assert.ok(car.vy <= ROADSTER.climbRate + .5); }
  }
  assert.equal(car.hops, 1); assert.ok(peak < ROADSTER.hoverHeight + .5);
  assert.ok(settled.every(h => Math.abs(h - ROADSTER.hoverHeight) < .2), `hover ${Math.min(...settled)}–${Math.max(...settled)}`);
  assert.ok(Math.abs(car.hoverTime - ROADSTER.tank) < .02);
  // Out of gas it falls and lands for good (no flicker of tiny hops).
  assert.ok(car.grounded); assert.equal(car.y, .06); assert.equal(car.hops, 1); assert.equal(car.landings, 1);
});

test('hovering slows a fall from a big jump and turns the car on the spot', () => {
  const car = roadster(); car.grounded = false; car.y = 40; car.vy = -20;
  let slowest = Infinity;
  // It sinks at the climb rate, then eases into the hover.
  for (let i = 0; i < 120 * 5; i++) { stepVehicle(car, { lift: true }, flat, []); if (car.y < 10) slowest = Math.min(slowest, -car.vy); }
  assert.ok(Math.abs(car.vy) < 1 && Math.abs(car.y - car.groundY - ROADSTER.hoverHeight) < .3, 'it settles at hover height');
  assert.ok(slowest < ROADSTER.climbRate + .5);
  // The flank nozzles yaw it at rest; its momentum keeps its direction.
  car.vx = 0; car.vz = 10; car.gas = 1; const heading = car.heading;
  advance(car, { lift: true, left: true }, flat, .5);
  assert.ok(car.heading - heading > .5 && car.heading - heading < .8, `${car.heading - heading} rad`);
  assert.ok(car.yaw > .9); assert.ok(Math.abs(Math.atan2(car.vx, car.vz)) < .1);
  advance(car, { lift: true }, flat, .5); assert.ok(Math.abs(car.yaw) < .01);
});

test('deep water: the thrusters carry it across without floating or transforming', () => {
  for (const seed of [1, 3, 77]) {
    const world = createWorld(seed), lake = world.starterLake;
    const car = roadster(world, lake.x, lake.z - lake.rz * 1.12, 0);
    let over = 0;
    for (let i = 0; i < 120 * 17; i++) {
      stepVehicle(car, { up: true }, world, []);
      assert.equal(car.floating, false); assert.equal(car.boatMode, false); assert.equal(car.transform, 0);
      if (car.overWater && car.grounded) {
        over++;
        assert.ok(Math.abs(car.y - (car.waterLevel + ROADSTER.waterGap + .06)) < .02, `seed ${seed} skims at ${car.y - car.waterLevel}`);
        assert.equal(car.onRoad, false);
      }
    }
    // Skimming uses no gas, and the crossing counts as water distance.
    assert.equal(car.gas, 1);
    assert.ok(over * FIXED_DT > 2 && car.waterDistance > 100, `seed ${seed}: ${car.waterDistance} m over water`);
    assert.ok(car.z > lake.z + lake.rz && car.speed > 10);
  }
});

test('starting or recovering on water keeps the Roadster above it, with its records', () => {
  const world = createWorld(3), lake = world.starterLake;
  const car = roadster(world, lake.x, lake.z), water = world.waterAt(lake.x, lake.z);
  assert.ok(car.overWater && car.grounded && !car.floating);
  assert.ok(Math.abs(car.y - (water.level + ROADSTER.waterGap + .06)) < 1e-6);
  assert.equal(hoverWorld(world), hoverWorld(world));
  assert.equal(hoverWorld(world).surface(lake.x, lake.z), water.level + ROADSTER.waterGap);
  Object.assign(car, { hops: 3, boostTime: 2, hoverTime: 4, waterDistance: 150, distance: 900, gas: .2 });
  assert.ok(recoverVehicle(car, world));
  assert.equal(car.kind, 'roadster'); assert.equal(car.gas, 1);
  assert.deepEqual([car.hops, car.boostTime, car.hoverTime, car.waterDistance, car.distance], [3, 2, 4, 150, 900]);
  assert.ok(!world.waterAt(car.x, car.z));
});

test('suction fans: it climbs faces up to about 65° that the ATLAS slides back down', () => {
  const climb = (kind, grade) => {
    const slope = { ...grass, surface: (x, z) => z * grade, gradient: () => ({ x: 0, z: grade }) };
    const car = createVehicle(slope, 0, 0, 0, kind); let best = 0;
    for (let i = 0; i < 2400; i++) { stepVehicle(car, { up: true }, slope, []); best = Math.max(best, car.vz); }
    return { best: best * 3.6, final: car.vz * 3.6, suction: car.suction };
  };
  const at = degrees => Math.tan(degrees * Math.PI / 180);
  assert.ok(climb('atlas', at(48)).final < 0, 'the ATLAS slides back off a 48° face');
  assert.ok(climb('roadster', at(45)).best > 120, 'the Roadster takes 45° at speed');
  const sixty = climb('roadster', at(60)), sixtyFive = climb('roadster', at(65));
  assert.ok(sixty.final > 70 && sixty.suction, `60°: ${sixty.final} km/h`);
  assert.ok(sixtyFive.final > 30, `65°: ${sixtyFive.final} km/h`);
  assert.ok(climb('roadster', at(70)).final < 5, 'at 70° even the fans give out');
  // A sheer face still stops it, as a 52° one stops the ATLAS.
  const wall = degrees => {
    const rise = z => z < 10 ? 0 : (z - 10) * at(degrees);
    const world = { ...grass, surface: (x, z) => rise(z), gradient: (x, z) => ({ x: 0, z: z < 10 ? 0 : at(degrees) }) };
    const car = roadster(world); car.vz = 12;
    for (let i = 0; i < 600; i++) stepVehicle(car, { up: true }, world, []);
    return car.z;
  };
  assert.ok(wall(60) > 50, 'it drives up a 60° wall'); assert.ok(wall(75) < 11.5, 'a 75° wall holds it at the foot');
  assert.ok(SUCTION.wall > 1.3 && Math.atan(SUCTION.wall) * 180 / Math.PI < 75);
});

test('suction fans: it corners far harder and stays down over crests; never on water', () => {
  const turn = kind => {
    const car = createVehicle(flat, 0, 0, 0, kind); car.vz = 100 / 3.6;
    advance(car, { left: true }, flat, 1);
    return { angle: car.heading, slip: Math.abs(car.vx * Math.cos(car.heading) - car.vz * Math.sin(car.heading)) };
  };
  const atlas = turn('atlas'), car = turn('roadster');
  assert.ok(car.angle > atlas.angle * 1.5, `turned ${car.angle} rad (ATLAS ${atlas.angle})`);
  assert.ok(car.slip < 3);
  // A 30° bank, 6 m high, met at 90 km/h: the ATLAS flies off the top, the Roadster holds on.
  const bank = z => z < 10 ? 0 : z < 20.4 ? (z - 10) * .577 : 6;
  const land = { ...grass, surface: (x, z) => bank(z), gradient: (x, z) => ({ x: 0, z: z >= 10 && z < 20.4 ? .577 : 0 }) };
  const highest = kind => { const c = createVehicle(land, 0, 0, 0, kind); c.vz = 25; let top = 0; for (let i = 0; i < 360; i++) { stepVehicle(c, {}, land, []); top = Math.max(top, c.y - bank(c.z)); } return top; };
  assert.ok(highest('atlas') > 1, 'the ATLAS leaves the crest');
  assert.ok(highest('roadster') < .5, 'the Roadster stays down');
  const world = createWorld(3), lake = world.starterLake, skimmer = roadster(world, lake.x, lake.z);
  stepVehicle(skimmer, { up: true }, world, []);
  assert.equal(skimmer.suction, false);
});

test('braking tilts the wing into an air brake that adds drag', () => {
  const coast = input => { const car = roadster(); car.vz = 80; advance(car, input, flat, .5); return car; };
  const braked = coast({ down: true }), drifting = coast({ brake: true }), coasting = coast({});
  assert.equal(braked.airBrake, true); assert.equal(drifting.airBrake, true); assert.equal(coasting.airBrake, false);
  assert.equal(AIR_BRAKE, 3);
  // Same brakes, but the wing's drag on top: the air brake alone takes off more at speed.
  const plain = roadster(); plain.vz = 80; plain.airBrake = false;
  const flap = roadster(); flap.vz = 80;
  stepVehicle(plain, {}, flat, []); const lostPlain = 80 - plain.vz;
  flap.vz = 80; stepVehicle(flap, { down: true }, flat, []);
  assert.ok(80 - flap.vz > lostPlain);
  // Stopped or reversing, the wing lies flat again.
  const slow = roadster(); advance(slow, { down: true }, flat, 1); assert.equal(slow.airBrake, false);
});

test('with the fans switched off it handles like any car: no steep climbs, no extra grip, big crest jumps', () => {
  const climb = (fans, grade) => {
    const slope = { ...grass, surface: (x, z) => z * grade, gradient: () => ({ x: 0, z: grade }) };
    const car = roadster(slope); car.fans = fans;
    advance(car, { up: true }, slope, 20);
    return { speed: car.vz * 3.6, suction: car.suction };
  };
  assert.ok(climb(true, 1).speed > 120 && climb(true, 1).suction);
  const off = climb(false, 1);
  assert.ok(off.speed < 0 && off.suction === false, `fans off, 45°: ${off.speed} km/h`);
  const turn = fans => { const car = roadster(); car.fans = fans; car.vz = 100 / 3.6; advance(car, { left: true }, flat, 1); return car.heading; };
  assert.ok(turn(true) > turn(false) * 1.4);
  const bank = z => z < 10 ? 0 : z < 20.4 ? (z - 10) * .577 : 6;
  const land = { ...grass, surface: (x, z) => bank(z), gradient: (x, z) => ({ x: 0, z: z >= 10 && z < 20.4 ? .577 : 0 }) };
  const crest = fans => { const car = roadster(land); car.fans = fans; car.vz = 25; let top = 0; for (let i = 0; i < 360; i++) { stepVehicle(car, {}, land, []); top = Math.max(top, car.y - bank(car.z)); } return top; };
  assert.ok(crest(false) > 1 && crest(true) < .5, 'off, it flies off the crest; on, it holds');
  // Space jumps the same either way; recovery keeps the switch where it was.
  const jump = fans => { const car = roadster(); car.fans = fans; let top = 0; for (let i = 0; i < 120; i++) { stepVehicle(car, { jump: true }, flat, []); top = Math.max(top, car.y); } return top; };
  assert.equal(jump(true), jump(false));
  const world = createWorld(483921), car = roadster(world, 340, -210); car.fans = false;
  assert.ok(recoverVehicle(car, world)); assert.equal(car.fans, false);
});
