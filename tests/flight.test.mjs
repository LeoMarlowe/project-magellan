import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createVehicle, stepVehicle, FIXED_DT } from '../world.mjs';
import { toggleFlight, rotate, attitudeFromEuler, wingClearance, liftCoefficient, airDensity, TAKEOFF_SPEED, STALL_SPEED, CEILING, FLIGHT_TRANSFORM_SECONDS } from '../flight-motion.mjs';

const world = createWorld(3);
function run(car, input, seconds, each) {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) { stepVehicle(car, input, world, []); each?.(car); }
  return car;
}
const altitude = car => car.y - world.surface(car.x, car.z);
const q = car => [car.qx, car.qy, car.qz, car.qw];
const mastUp = car => rotate(q(car), [0, 1, 0])[1], noseUp = car => rotate(q(car), [0, 0, 1])[1];
// Climb to a comfortable height first: pitch up briefly, then fly on.
// Level flight 300 m above the ground at 80 m/s, well clear of the assists.
function high(car, speed = 80) {
  [car.qx, car.qy, car.qz, car.qw] = attitudeFromEuler(car.heading, 0, 0);
  Object.assign(car, { pitch: 0, roll: 0, climb: 0, airspeed: speed, y: world.surface(car.x, car.z) + 300,
    vx: Math.sin(car.heading) * speed, vy: 0, vz: Math.cos(car.heading) * speed });
  return car;
}
function airborne() {
  const car = createVehicle(world); toggleFlight(car);
  run(car, { up: true }, 8);
  assert.equal(car.flying, true);
  return car;
}

test('wings unfold while driving, then the car taxis, lifts off at speed and climbs', () => {
  const car = createVehicle(world);
  assert.equal(car.flight, 0); assert.equal(toggleFlight(car), true);
  run(car, { up: true }, FLIGHT_TRANSFORM_SECONDS * .5);
  assert.ok(car.flight > .4 && car.flight < .6); assert.equal(car.flying, false);
  let liftOff = null;
  run(car, { up: true }, 8, c => { if (c.flying && liftOff === null) liftOff = Math.abs(c.airspeed); });
  assert.equal(car.flight, 1); assert.equal(car.flying, true);
  // It was already past lift-off speed when the wings locked, so it rotated at once.
  assert.ok(liftOff >= TAKEOFF_SPEED - .5, `lift-off at ${liftOff}`);
  const start = altitude(car);
  run(car, { up: true, jump: true }, .6); run(car, { up: true }, 5.4);
  assert.ok(altitude(car) > start + 40, `climbed to ${altitude(car)} m`);
  assert.ok(car.flights === 1 && car.flightDistance > 100);
  assert.ok(car.alpha > -.2 && car.alpha < .28, `flying below the stall: ${car.alpha}`);
});

test('from a standstill the propeller taxis the car to lift-off speed, and hands-off it climbs out', () => {
  const car = createVehicle(world); toggleFlight(car);
  run(car, {}, FLIGHT_TRANSFORM_SECONDS + .1);
  assert.equal(car.flight, 1); assert.equal(car.flying, false); assert.ok(Math.abs(car.speed) < .5);
  let liftOff = null;
  run(car, { up: true }, 8, c => { if (c.flying && liftOff === null) liftOff = c.airspeed; });
  assert.ok(liftOff > TAKEOFF_SPEED - .5 && liftOff < TAKEOFF_SPEED + 1, `lift-off at ${liftOff}`);
  run(car, {}, 12);
  assert.equal(car.flying, true);
  assert.ok(altitude(car) > 20 && altitude(car) < 100, `levels out at ${altitude(car)} m`);
  assert.ok(Math.abs(car.climb) < .12, 'and flies level');
});

test('the wing makes lift from its angle of attack and stalls past 16°', () => {
  assert.ok(liftCoefficient(0) > 0 && liftCoefficient(.2) > liftCoefficient(.1));
  assert.ok(liftCoefficient(.4) < liftCoefficient(.28) * .8, 'stalled');
  assert.ok(liftCoefficient(-.2) < 0);
  assert.equal(airDensity(0), 1); assert.ok(airDensity(CEILING + 50) < .6);
});

test('upright and hands off it holds its height; upside down it falls', () => {
  const level = high(airborne()), start = level.y;
  run(level, {}, 6);
  assert.equal(level.flying, true); assert.ok(Math.abs(level.y - start) < 40, `held ${level.y - start}`);
  const flipped = high(airborne()), top = flipped.y;
  run(flipped, { rollLeft: true }, 1.43);
  assert.ok(mastUp(flipped) < -.8, `inverted ${mastUp(flipped)}`);
  run(flipped, {}, 3);
  assert.ok(top - flipped.y > 50, `fell ${top - flipped.y} m`); assert.ok(flipped.climb < -.3, 'nose dropping toward the ground');
});

test('there is no thrust unless W is held: hands off it glides and slows, and S brakes harder', () => {
  const coast = high(airborne(), 70), brake = high(airborne(), 70), power = high(airborne(), 70);
  let fastest = 0;
  run(coast, {}, 5, c => { fastest = Math.max(fastest, c.airspeed); });
  run(brake, { down: true }, 5); run(power, { up: true }, 5);
  assert.ok(fastest <= 70.5 && coast.airspeed < 66, `coasting ${coast.airspeed}, peak ${fastest}`);
  assert.ok(brake.airspeed < coast.airspeed - 3 && power.airspeed > 75, `brake ${brake.airspeed}, power ${power.airspeed}`);
});

test('a bank alone barely turns; banking and pulling turns hard', () => {
  const lazy = high(airborne()), h0 = lazy.heading;
  run(lazy, { rollLeft: true }, .5); run(lazy, {}, 3);
  const lazyTurn = lazy.heading - h0;
  assert.ok(lazy.roll < -.6, `the bank is held when released: ${lazy.roll}`);
  assert.ok(lazyTurn > 0, 'a held bank turns gently');
  const pulled = high(airborne()), h1 = pulled.heading;
  run(pulled, { rollLeft: true }, .5); run(pulled, { pitchUp: true }, 3);
  assert.ok(pulled.heading - h1 > .6 && pulled.heading - h1 > lazyTurn * 2, `pulled ${pulled.heading - h1} vs ${lazyTurn}`);
  assert.equal(pulled.flying, true);
});

test('holding roll performs a full barrel roll and the plane flies on', () => {
  const car = high(airborne()), start = car.y;
  let lowest = 1;
  run(car, { rollRight: true }, 2.9, c => { lowest = Math.min(lowest, mastUp(c)); });
  assert.ok(lowest < -.9, `rolled inverted: ${lowest}`);
  run(car, {}, 3);
  assert.equal(car.flying, true); assert.ok(Math.abs(car.y - start) < 150);
});

test('a pull climbs and the path then holds; holding it at full power flies a loop', () => {
  const car = high(airborne(), 90);
  run(car, { pitchUp: true, up: true }, 1);
  const path = car.climb;
  assert.ok(path > .2, `climbing at ${path}`);
  run(car, { up: true }, 1.5);
  assert.ok(Math.abs(car.climb - path) < .2, `holds ${car.climb} near ${path}`);
  const loop = high(airborne(), 92); let inverted = false;
  run(loop, { up: true, pitchUp: true }, 9, c => { if (mastUp(c) < -.8) inverted = true; });
  assert.ok(inverted, 'went over the top of the loop'); assert.equal(loop.flying, true);
});

test('yaw swings the nose without much bank', () => {
  const car = high(airborne()), heading = car.heading;
  run(car, { yawLeft: true }, 2);
  assert.ok(car.heading > heading + .1, `yawed ${car.heading - heading}`);
  assert.ok(Math.abs(car.roll) < .5);
});

test('idle power and a pull stall the wing; the nose drops and power recovers it; thin air caps the climb', () => {
  const car = high(airborne(), 60);
  let peakAlpha = 0, lowestPath = 1;
  run(car, { down: true, pitchUp: true }, 6, c => { peakAlpha = Math.max(peakAlpha, c.alpha); });
  run(car, { down: true }, 6, c => { lowestPath = Math.min(lowestPath, c.climb); });
  assert.ok(peakAlpha > .26, `stalled at ${peakAlpha}`); assert.ok(lowestPath < -.3, `nose dropped: ${lowestPath}`);
  // Recovery is the pilot's job now: power on, let it build speed, ease out.
  run(car, { up: true }, 1.5); run(car, { up: true, pitchUp: true }, 2.5);
  assert.ok(car.flying && car.airspeed > STALL_SPEED + 15, `recovered to ${car.airspeed}, flying ${car.flying}`);
  const climber = airborne(); let peak = 0;
  run(climber, { up: true, pitchUp: true }, .8);
  run(climber, { up: true }, 60, c => { peak = Math.max(peak, c.y); });
  // It can zoom a little above the ceiling on its speed, then the thin air wins.
  assert.ok(peak > CEILING - 100 && peak < CEILING + 250, `peak ${peak}`);
});

test('touching down below lift-off speed lands: as the car on ground, as the boat on deep water', () => {
  const car = airborne(), speed = 24;
  Object.assign(car, { vx: Math.sin(car.heading) * speed, vz: Math.cos(car.heading) * speed, vy: -1, airspeed: speed, y: world.surface(car.x, car.z) + .2, climbOut: false });
  [car.qx, car.qy, car.qz, car.qw] = attitudeFromEuler(car.heading, -.05, 0);
  run(car, {}, .6); // long enough to meet ground that falls away a little
  assert.equal(car.flying, false); assert.equal(car.flightMode, false); assert.equal(car.grounded, true);
  run(car, {}, FLIGHT_TRANSFORM_SECONDS + .1);
  assert.equal(car.flight, 0, 'the wings fold away');
  const lake = world.starterLake, boat = airborne();
  Object.assign(boat, { x: lake.x, z: lake.z, heading: 0, vx: 0, vz: speed, vy: -1, airspeed: speed, y: lake.level - .4, climbOut: false });
  [boat.qx, boat.qy, boat.qz, boat.qw] = attitudeFromEuler(0, -.05, 0);
  run(boat, {}, .3);
  assert.equal(boat.flying, false); assert.equal(boat.flightMode, false); assert.equal(boat.floating, true);
  let hulls = 0; run(boat, {}, 3, c => { hulls = Math.max(hulls, c.transform); });
  assert.ok(hulls > .9, 'the hulls deploy');
  // A take-off run on the ground is not a landing: it still taxis to lift-off.
  const runway = createVehicle(world); toggleFlight(runway);
  run(runway, {}, FLIGHT_TRANSFORM_SECONDS + .1);
  run(runway, { up: true }, 6);
  assert.equal(runway.flying, true);
});

test('at flying speed the ground never turns the plane into a car: it bounces or skims and flies on', () => {
  for (const [label, pitch, roll, vy] of [['skim', -.05, 0, -1], ['steep dive', .5, 0, -30], ['hard flat', 0, 0, -15]]) {
    const car = airborne(), speed = 70, start = world.surface(car.x, car.z);
    Object.assign(car, { vx: Math.sin(car.heading) * speed, vz: Math.cos(car.heading) * speed, vy, airspeed: Math.hypot(speed, vy), y: start + .3 });
    [car.qx, car.qy, car.qz, car.qw] = attitudeFromEuler(car.heading, pitch, roll);
    run(car, { up: true }, .2);
    assert.equal(car.flightMode, true, label); assert.equal(car.flying, true, `${label} still flying`);
    assert.ok(car.airspeed > 45, `${label} keeps most of its speed: ${car.airspeed}`);
    assert.ok(mastUp(car) > 0, `${label} ends upright`);
    run(car, { up: true }, 3);
    assert.ok(car.flying && car.y > world.surface(car.x, car.z) + 2, `${label} flies on`);
  }
  // Upside down, the fins and wings reach the ground first: that ends the flight.
  const flipped = airborne(), speed = 70;
  Object.assign(flipped, { vx: Math.sin(flipped.heading) * speed, vz: Math.cos(flipped.heading) * speed, vy: -6, airspeed: speed, y: world.surface(flipped.x, flipped.z) + 1.5, climbOut: false });
  [flipped.qx, flipped.qy, flipped.qz, flipped.qw] = attitudeFromEuler(flipped.heading, 0, Math.PI);
  run(flipped, {}, .3);
  assert.equal(flipped.flightMode, false, 'inverted ground contact turns it into the car');
  // Skimming across water at speed is the same: no splashdown into boat mode.
  const lake = world.starterLake, boat = airborne();
  Object.assign(boat, { x: lake.x, z: lake.z - lake.rz * .6, heading: 0, vx: 0, vz: 70, vy: -3, airspeed: 70, y: lake.level - .4 });
  [boat.qx, boat.qy, boat.qz, boat.qw] = attitudeFromEuler(0, 0, 0);
  run(boat, { up: true }, .3);
  assert.ok(boat.flying && boat.flightMode && boat.transform === 0, 'skims the lake and flies on');
});

test('folding the wings in the air glides down to a drivable landing', () => {
  const car = airborne();
  run(car, { up: true, jump: true }, 3);
  toggleFlight(car);
  let landed = false;
  run(car, {}, 40, c => { if (!landed && !c.flying && c.grounded) landed = true; });
  assert.ok(landed); assert.equal(car.flightMode, false); assert.equal(car.flight, 0);
  assert.ok(altitude(car) < 1 && car.grounded);
  assert.ok(car.bestJump < 25, 'a flight is not recorded as a jump');
  const x = car.x; run(car, { up: true }, 2); assert.ok(Math.abs(car.x - x) + Math.abs(car.speed) > 1, 'drives on');
});

test('touching down on deep water lands as a boat, and a boat can take off again', () => {
  const lake = world.starterLake;
  const car = createVehicle(world, lake.x, lake.z, 0);
  assert.equal(car.floating, true);
  car.flightMode = false; car.flight = 1; car.flying = true; car.airspeed = 40; car.climb = -.1;
  car.y = lake.level + 6; car.grounded = false; car.floating = false;
  [car.qx, car.qy, car.qz, car.qw] = attitudeFromEuler(0, .1, 0); car.vz = 40; car.vx = 0; car.vy = -3;
  run(car, {}, 4);
  assert.equal(car.flying, false); assert.equal(car.floating, true);
  let hulls = 0;
  run(car, {}, 3, c => { hulls = Math.max(hulls, c.transform); });
  assert.ok(hulls > .9, 'the hulls deploy again on the water');
  Object.assign(car, { x: lake.x, z: lake.z, vx: 0, vz: 0, y: lake.level - .52 }); run(car, {}, .5);
  // From the water: wings out, the floats retract, and it lifts off.
  toggleFlight(car);
  let lifted = false;
  run(car, { up: true }, 12, c => { if (c.flying) lifted = true; });
  assert.ok(lifted); assert.ok(car.transform < .2);
  // It keeps flying: the tail clears the water as the nose comes up.
  assert.equal(car.wingCrashes ?? 0, 0); assert.equal(car.flying, true); assert.ok(altitude(car) > 5);
});

test('a boat afloat on a lake unfolds its wings, planes up and takes off without the tail touching the water', () => {
  const lake = world.starterLake, car = createVehicle(world, lake.x, lake.z, 0);
  assert.equal(car.floating, true);
  toggleFlight(car);
  let lifted = false;
  run(car, { up: true }, 9, c => { if (c.flying) lifted = true; });
  assert.ok(lifted, 'lifted off');
  assert.equal(car.wingCrashes ?? 0, 0); assert.equal(car.flying, true); assert.equal(car.flightMode, true);
  assert.ok(car.y - lake.level > 5, `climbing: ${car.y - lake.level}`);
});

test('a tail or nose touching down during the take-off does not end the flight', () => {
  const lake = world.starterLake;
  for (const [name, make, input] of [
    ['water, nose held up', () => createVehicle(world, lake.x, lake.z, 0), { throttleUp: true, pitchUp: true }],
    ['water, simple climb', () => createVehicle(world, lake.x, lake.z, 0), { simpleFlight: true, up: true, jump: true }],
    ['land, simple climb from a jump', () => createVehicle(world), { simpleFlight: true, up: true, jump: true }],
  ]) {
    const car = make(); toggleFlight(car);
    run(car, input, 12);
    assert.equal(car.wingCrashes ?? 0, 0, name); assert.equal(car.flying, true, name); assert.equal(car.flightMode, true, name);
  }
});

test('settling back below lift-off speed while taking off keeps the wings and taxis on', () => {
  const car = createVehicle(world); car.vx = 0; car.vz = 15; car.speed = 15;
  car.grounded = false; car.vy = 5; car.y += 2;
  toggleFlight(car); car.flight = .5;
  let glided = false;
  run(car, {}, 3, c => { if (c.flying) glided = true; });
  assert.ok(glided);
  assert.equal(car.flying, false); assert.equal(car.flightMode, true); assert.equal(car.wingCrashes ?? 0, 0);
  run(car, { throttleUp: true }, 6);
  assert.equal(car.flying, true, 'and it can still take off');
});

test('a jumping car with its wings half out starts to glide', () => {
  const car = createVehicle(world); car.vx = 0; car.vz = 32; car.speed = 32;
  car.grounded = false; car.vy = 6; car.y += 3;
  toggleFlight(car);
  run(car, {}, FLIGHT_TRANSFORM_SECONDS * .4);
  assert.equal(car.flying, true);
});

test('a small bump while the wings unfold stays driving: no flight, no touchdown, the wings keep opening', () => {
  const car = createVehicle(world); car.vx = 0; car.vz = 20; car.speed = 20;
  toggleFlight(car);
  run(car, { up: true }, FLIGHT_TRANSFORM_SECONDS * .5);
  car.grounded = false; car.vy = 2; car.y += .25; car.airtime = 0; // a hop off a bump
  const flights = car.flights;
  run(car, { up: true }, .4, c => assert.equal(c.flying, false));
  assert.equal(car.flights, flights); assert.equal(car.flightMode, true);
  run(car, { up: true }, FLIGHT_TRANSFORM_SECONDS * .6);
  assert.equal(car.flight, 1);
});

test('a wingtip touching the ground ends the flight: it becomes the car and lands, never buried', () => {
  for (const side of ['rollLeft', 'rollRight']) {
    const car = airborne();
    [car.qx, car.qy, car.qz, car.qw] = attitudeFromEuler(car.heading, 0, 0);
    Object.assign(car, { vx: Math.sin(car.heading) * 60, vz: Math.cos(car.heading) * 60, vy: -2, y: world.surface(car.x, car.z) + 1.5, climbOut: false });
    let lowest = Infinity, crashed = false;
    run(car, { [side]: true, up: true }, .8, c => {
      if (c.flightMode) lowest = Math.min(lowest, -wingClearance(c, world).depth);
      if (c.wingCrashes) crashed = true;
    });
    assert.ok(crashed, `${side}: the wingtip touched down`);
    assert.ok(lowest > -1e-6, `${side}: never buried while a plane (${-lowest} m)`);
    assert.equal(car.flightMode, false); assert.equal(car.flying, false);
    run(car, {}, 3);
    assert.ok(car.grounded && car.flight === 0, `${side}: lands as the car with its wings folded`);
  }
});

test('wings break trees and boulders, and a strike swings the plane toward the struck wing', () => {
  const strike = (lateral, type, speed, height = 2.4, ahead = 12) => {
    const car = airborne(), h = car.heading;
    const x = car.x + Math.sin(h) * ahead + Math.cos(h) * lateral, z = car.z + Math.cos(h) * ahead - Math.sin(h) * lateral, ground = world.surface(x, z);
    [car.qx, car.qy, car.qz, car.qw] = attitudeFromEuler(h, 0, 0);
    Object.assign(car, { vx: Math.sin(h) * speed, vz: Math.cos(h) * speed, vy: 0, y: ground + height, airspeed: speed });
    const prop = { id: `wing-test:${type}:${lateral}:${speed}:${height}`, type, x, z, y: ground, size: 1, h: type === 'tree' ? 6.8 : 2.6, r: type === 'tree' ? .24 : 1.5 };
    const start = { heading: h };
    for (let i = 0; i < 120 * .5; i++) stepVehicle(car, {}, world, [prop]);
    return { car, broken: world.brokenProps.has(prop.id), turned: Math.atan2(Math.sin(car.heading - start.heading), Math.cos(car.heading - start.heading)), speed: Math.hypot(car.vx, car.vz) };
  };
  // +x is the left wing: a tree under it breaks, the nose swings left and the
  // left wing drops; the right wing is the mirror image.
  const left = strike(3, 'tree', 60), right = strike(-3, 'tree', 60);
  assert.ok(left.broken && right.broken);
  assert.ok(left.turned > .05 && right.turned < -.05, `yaw ${left.turned} / ${right.turned}`);
  assert.ok(left.car.roll < -.05 && right.car.roll > .05, `roll ${left.car.roll} / ${right.car.roll}`);
  assert.ok(left.speed < 58 && left.car.flying && left.car.flightMode);
  // A tip strike yanks harder than one near the wing root.
  const root = strike(1.4, 'tree', 60);
  assert.ok(Math.abs(root.turned) < Math.abs(left.turned), `root ${root.turned} vs tip ${left.turned}`);
  // A boulder is heavier than a tree; flying well above it misses it.
  const rock = strike(3, 'boulder', 60, .5, 8);
  assert.ok(rock.broken && rock.speed < left.speed && Math.abs(rock.turned) > Math.abs(left.turned));
  const above = strike(3, 'tree', 60, 9);
  assert.ok(!above.broken && Math.abs(above.turned) < .01, 'clears the canopy');
});

test('released controls keep the attitude: a dive stays a dive, a bank stays a bank, even low down', () => {
  const dive = high(airborne(), 70);
  run(dive, { pitchDown: true }, .8);
  const angle = dive.climb;
  assert.ok(angle < -.2);
  run(dive, {}, 2);
  assert.ok(dive.climb < angle + .05, `kept diving: ${angle} -> ${dive.climb}`);
  const bank = high(airborne(), 70);
  run(bank, { rollRight: true }, .5);
  const rolled = bank.roll;
  run(bank, {}, 3);
  assert.ok(bank.roll > rolled * .8, `kept its bank: ${rolled} -> ${bank.roll}`);
  // No hands-off pull-up near the ground either (that is only for take-off).
  const low = high(airborne(), 70);
  low.y = world.surface(low.x, low.z) + 30;
  run(low, { pitchDown: true }, .4);
  const lowAngle = low.climb;
  run(low, {}, .6);
  assert.ok(low.climb < lowAngle + .05, `not pulled up: ${lowAngle} -> ${low.climb}`);
});

const bankOf = car => { const m = rotate(q(car), [0, 1, 0]), w = rotate(q(car), [1, 0, 0]); return Math.atan2(w[1], m[1]); };
const simple = input => ({ simpleFlight: true, ...input });
test('simple controls: left and right bank to turn and level the wings again when released, holding height', () => {
  const car = high(airborne(), 80); car.climbOut = false;
  const y = car.y, heading = car.heading;
  run(car, simple({ up: true, left: true }), 3);
  assert.ok(bankOf(car) < -.6, `banked left: ${bankOf(car)}`);
  assert.ok(car.heading - heading > 1.2, `turned left quickly: ${car.heading - heading}`);
  run(car, simple({ up: true }), 3);
  assert.ok(Math.abs(bankOf(car)) < .03, `levelled: ${bankOf(car)}`);
  assert.ok(Math.abs(car.y - y) < 15, `height held: ${car.y - y}`);
  run(car, simple({ up: true, right: true }), 2);
  assert.ok(bankOf(car) > .6);
});

test('simple controls: Space climbs, Shift dives, hands off holds level, and there is no thrust without W', () => {
  const car = high(airborne(), 80); car.climbOut = false;
  let y = car.y;
  run(car, simple({ up: true, jump: true }), 3); assert.ok(car.y - y > 40, `climbed: ${car.y - y}`);
  run(car, simple({ up: true }), 4); y = car.y;
  run(car, simple({ up: true }), 3); assert.ok(Math.abs(car.y - y) < 5, `level: ${car.y - y}`);
  run(car, simple({ up: true, brake: true }), 2); assert.ok(car.y - y < -30, `dived: ${car.y - y}`);
  run(car, simple({ up: true }), 4);
  const speed = car.airspeed;
  run(car, simple({}), 4); assert.ok(car.airspeed < speed - 5, 'slows without throttle');
  assert.equal(car.flying, true);
});

test('simple controls roll an inverted plane upright, and take off with W from the ground', () => {
  const inverted = high(airborne(), 70);
  [inverted.qx, inverted.qy, inverted.qz, inverted.qw] = attitudeFromEuler(inverted.heading, 0, 3);
  inverted.climbOut = false;
  run(inverted, simple({ up: true }), 4);
  assert.ok(mastUp(inverted) > .99);
  const car = createVehicle(world), start = car.y; toggleFlight(car);
  run(car, simple({ up: true }), 8);
  assert.equal(car.flying, true); assert.ok(car.y - start > 25, `climbed out: ${car.y - start}`);
});

test('a climb pressed in the air never fires a jump on landing, tapped or held', () => {
  for (const hold of [false, true]) {
    const car = high(airborne(), 25); car.climbOut = false;
    car.y = world.surface(car.x, car.z) + 3; car.vy = -1;
    car.jumpBuffer = .16; // the game's Space keydown writes this, even in the air
    run(car, hold ? { jump: true, pitchUp: true } : {}, .3);
    toggleFlight(car); // fold the wings and land
    const jumps = car.jumps;
    run(car, hold ? { jump: true } : {}, 3);
    assert.equal(car.grounded, true); assert.equal(car.jumps, jumps, hold ? 'held' : 'tapped');
  }
});

test('holding the nose down with the wings out keeps rolling on the ground, never skipping off it', () => {
  // As in the game: ↑ is accelerate while the wings unfold, then nose-down.
  const car = createVehicle(world); toggleFlight(car);
  let flights = 0, hits = 0, last = false, fastest = 0;
  run(car, { up: true, throttleUp: false, pitchDown: true }, 14, c => {
    if (c.flying && !last) flights++; last = c.flying; fastest = Math.max(fastest, c.speed);
    if (c.impact > .05) hits++;
  });
  assert.equal(flights, 0); assert.equal(hits, 0); assert.ok(fastest > TAKEOFF_SPEED, 'rolled faster than lift-off speed');
  // Easing off lets it lift off.
  run(car, { throttleUp: true }, 4);
  assert.equal(car.flying, true);
});

test('a gentle touchdown at speed with the nose pushed down rolls on with the wings out', () => {
  const car = high(airborne(), 60); car.climbOut = false; car.takeoff = 0;
  car.y = world.surface(car.x, car.z) + .4; car.vy = -1.5;
  run(car, { throttleUp: true, pitchDown: true }, 1);
  assert.equal(car.flying, false); assert.equal(car.flightMode, true); assert.equal(car.wingCrashes ?? 0, 0);
});

test('Q and E yaw the plane: the flight path turns with the nose, both ways, without banking', () => {
  for (const [key, sign] of [['yawLeft', 1], ['yawRight', -1]]) {
    const car = high(airborne(), 80); car.climbOut = false;
    const path = Math.atan2(car.vx, car.vz), y = car.y;
    run(car, { throttleUp: true, [key]: true }, 2);
    const turned = (Math.atan2(car.vx, car.vz) - path) * sign;
    assert.ok(turned > .5, `${key} turned the flight path ${turned} rad`);
    assert.ok(Math.abs(car.heading - Math.atan2(car.vx, car.vz)) < .1, 'nose and path agree: no crabbing');
    assert.ok(Math.abs(bankOf(car)) < .05); assert.ok(Math.abs(car.y - y) < 20); assert.equal(car.flying, true);
  }
});
