import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehiclePresentation } from '../vehicle-presentation.mjs';
import { createWorld, createVehicle, stepVehicle, groundAt, FIXED_DT } from '../world.mjs';
const flat = { surface: () => 0 };

test('car and wheel motion remain uniform between physics ticks at different refresh rates', () => {
  for (const hz of [60, 90, 144, 165, 240]) {
    const car = createVehicle(flat); car.speed = 60;
    const presentation = createVehiclePresentation(car);
    let elapsed = 0, accumulator = 0, lastZ, lastWheel;
    for (let frame = 0; frame < hz * 2; frame++) {
      const dt = 1 / hz; elapsed += dt; accumulator += dt;
      while (accumulator >= FIXED_DT) {
        car.z += car.speed * FIXED_DT;
        presentation.advance(car, FIXED_DT); accumulator -= FIXED_DT;
      }
      const pose = presentation.sample(accumulator / FIXED_DT);
      if (elapsed > FIXED_DT * 2) {
        assert.ok(Math.abs(pose.z - 60 * (elapsed - FIXED_DT)) < 1e-9, `continuous position at ${hz} Hz`);
        if (lastZ !== undefined) {
          assert.ok(Math.abs(pose.z - lastZ - 60 * dt) < 1e-9, `no repeated or doubled displacement at ${hz} Hz`);
          assert.ok(Math.abs(pose.wheelAngle - lastWheel - 60 * dt / .57) < 1e-9);
        }
        lastZ = pose.z; lastWheel = pose.wheelAngle;
      }
    }
  }
});

test('uneven rendering intervals do not quantize motion or mutate the physics state', () => {
  const car = createVehicle(flat); car.speed = 50;
  const presentation = createVehiclePresentation(car);
  let elapsed = 0, accumulator = 0;
  for (let i = 0; i < 100; i++) {
    const dt = [.004, .013, .008, .025][i % 4]; elapsed += dt; accumulator += dt;
    while (accumulator >= FIXED_DT) { car.z += 50 * FIXED_DT; car.y += 2 * FIXED_DT; presentation.advance(car, FIXED_DT); accumulator -= FIXED_DT; }
    const before = { ...car }, pose = presentation.sample(accumulator / FIXED_DT);
    if (elapsed > FIXED_DT) {
      assert.ok(Math.abs(pose.z - 50 * (elapsed - FIXED_DT)) < 1e-9);
      assert.ok(Math.abs(pose.y - .06 - 2 * (elapsed - FIXED_DT)) < 1e-9);
    }
    assert.deepEqual(car, before);
  }
});

test('landing angle normalization does not reverse the visual barrel roll', () => {
  const car = createVehicle(flat); car.roll = Math.PI * 2 - .04;
  const presentation = createVehiclePresentation(car);
  car.roll = .04; presentation.advance(car, FIXED_DT);
  assert.ok(Math.abs(presentation.sample(.5).roll - Math.PI * 2) < 1e-10);
  car.heading = Math.PI - .02; presentation.reset(car);
  car.heading = -Math.PI + .02; presentation.advance(car, FIXED_DT);
  assert.ok(Math.abs(presentation.sample(.5).heading - Math.PI) < 1e-10);
});

test('recovery and world reset discard the old interpolation path', () => {
  const car = createVehicle(flat), presentation = createVehiclePresentation(car);
  car.z = 100; presentation.advance(car, FIXED_DT);
  const recovered = createVehicle(flat, -1000, 2500);
  presentation.reset(recovered);
  for (const alpha of [0, .5, 1]) {
    const pose = presentation.sample(alpha);
    assert.equal(pose.x, -1000); assert.equal(pose.z, 2500); assert.equal(pose.wheelAngle, 0);
  }
});

test('grounded interpolation follows terrain creases without moving the simulation', () => {
  // The two physics ticks straddle a ridge or valley in a triangular grid.
  for (const direction of [-1, 1]) {
    const world = { surface: x => direction * Math.abs(x) };
    const car = createVehicle(world, -.4, 0);
    const presentation = createVehiclePresentation(car, (x, z, heading) => groundAt(world, x, z, heading).y);
    Object.assign(car, createVehicle(world, .4, 0)); presentation.advance(car, FIXED_DT);
    const before = { ...car };
    for (const alpha of [0, .1, .5, .9, 1]) {
      const pose = presentation.sample(alpha);
      assert.ok(Math.abs(pose.x - (-.4 + .8 * alpha)) < 1e-12);
      assert.equal(pose.y, groundAt(world, pose.x, pose.z, pose.heading).y);
      assert.equal(pose.groundY, pose.y);
    }
    assert.deepEqual(car, before);
  }
});

test('grounded presentation matches support between real desert physics ticks', () => {
  const world = createWorld(100003), car = createVehicle(world);
  const presentation = createVehiclePresentation(car, (x, z, heading) => groundAt(world, x, z, heading).y);
  let checked = 0, uncorrectedError = 0;
  for (let i = 0; i < 900; i++) {
    const previous = { ...car };
    stepVehicle(car, { up: true }, world, []); presentation.advance(car, FIXED_DT);
    if (!previous.grounded || !car.grounded || previous.transform !== 0 || car.transform !== 0) continue;
    for (const alpha of [.25, .5, .75]) {
      const pose = presentation.sample(alpha), support = groundAt(world, pose.x, pose.z, pose.heading).y;
      uncorrectedError = Math.max(uncorrectedError, Math.abs(previous.y + (car.y - previous.y) * alpha - support));
      assert.ok(Math.abs(pose.y - support) < 1e-10);
      checked++;
    }
  }
  assert.ok(checked > 500);
  // Cars now leave rounded crests instead of clinging to them, which removes
  // the largest mismatches from grounded pairs, and the land is smoother
  // than it was; a measurable one (a few millimetres) remains.
  assert.ok(uncorrectedError > .002, `fixture reproduces the original contact-height mismatch (${uncorrectedError} m)`);
});

test('launch, landing and transformation intervals retain their interpolated flight height', () => {
  for (const [fromGrounded, toGrounded, fromTransform, toTransform] of [
    [true, false, 0, 0], [false, true, 0, 0], [false, false, 0, 0],
    [true, true, 0, .1], [true, true, .1, 0], [false, false, 1, 1],
  ]) {
    const car = createVehicle(flat); car.grounded = fromGrounded; car.transform = fromTransform;
    let reads = 0;
    const presentation = createVehiclePresentation(car, () => { reads++; return 100; });
    car.y = 10; car.grounded = toGrounded; car.transform = toTransform;
    presentation.advance(car, FIXED_DT); reads = 0;
    assert.ok(Math.abs(presentation.sample(.5).y - 5.03) < 1e-10);
    assert.equal(reads, 0, 'airborne and transforming poses must not snap to land');
  }
});

test('ground support follows the new world on reset and retains intentional clearance', () => {
  let world = flat;
  const car = createVehicle(world); car.y += .12;
  const presentation = createVehiclePresentation(car, (x, z, heading) => groundAt(world, x, z, heading).y);
  assert.equal(presentation.sample(.5).y, .18);
  world = { surface: () => 42 };
  presentation.reset(createVehicle(world, 1000, -1000));
  for (const alpha of [0, .5, 1]) assert.equal(presentation.sample(alpha).y, 42.06);
});
