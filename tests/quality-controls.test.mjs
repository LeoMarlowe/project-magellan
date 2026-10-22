import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityLevels, presetLevel, autoStartLevel, createAutoQuality, refreshInterval, isSlowFrame } from '../quality.mjs';
import { controlAxis, steerAxis } from '../controls.mjs';
import { createWorld, createVehicle, stepVehicle } from '../world.mjs';

// Feed a constant frame interval for a duration; return every level change.
function drive(auto, ms, seconds, from = 0) {
  const changes = [];
  for (let now = from; now < from + seconds * 1000; now += ms) {
    const next = auto.sample(ms, now);
    if (next !== null) changes.push({ level: next, at: now });
  }
  return changes;
}

test('quality presets keep the previous fixed settings as Medium (phone) and High (desktop)', () => {
  const phone = qualityLevels(true), desktop = qualityLevels(false);
  assert.deepEqual(phone[presetLevel('medium')], { name: 'medium', pixelRatio: 1.35, shadow: 1024, farShadow: 1024, grass: { density: .2, range: 48, fade: 22, blades: 'simple' } });
  assert.deepEqual(desktop[presetLevel('high')], { name: 'high', pixelRatio: 1.7, shadow: 2048, farShadow: 1024, grass: { density: 1, range: 78, fade: 38, blades: 'full' } });
  assert.equal(phone[presetLevel('high')].pixelRatio, 2);
  assert.equal(autoStartLevel(true), 1); assert.equal(autoStartLevel(false), 3);
  for (const levels of [phone, desktop]) for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i].pixelRatio > levels[i - 1].pixelRatio);
    assert.ok(levels[i].shadow >= levels[i - 1].shadow);
    assert.ok(levels[i].grass.density > levels[i - 1].grass.density);
  }
});

test('auto quality climbs on sustained smooth frames and stops at the top', () => {
  const auto = createAutoQuality({ start: 1, max: 3 });
  const changes = drive(auto, 1000 / 60, 40);
  assert.deepEqual(changes.map(c => c.level), [2, 3]);
  assert.ok(changes[0].at >= 6000);
});

test('auto quality steps down after sustained slow frames, but ignores single hitches and pauses', () => {
  const auto = createAutoQuality({ start: 3, max: 3 });
  // A 120 ms chunk-streaming hitch every second averages out; a pause is skipped.
  let changes = [];
  for (let now = 0; now < 20000; now += 1000 / 60) {
    const ms = Math.floor(now / 1000) !== Math.floor((now - 1000 / 60) / 1000) ? 120 : 1000 / 60;
    const next = auto.sample(ms, now); if (next !== null) changes.push(next);
  }
  assert.equal(auto.sample(4000, 20100), null);
  assert.deepEqual(changes, []);
  changes = drive(auto, 1000 / 30, 3, 21000);
  assert.deepEqual(changes.map(c => c.level), [2]);
});

test('auto quality does not oscillate: a level that fails twice is never retried', () => {
  const auto = createAutoQuality({ start: 3, max: 3, retryMs: 1000 });
  let now = 0;
  const phase = (ms, seconds) => { const changes = drive(auto, ms, seconds, now); now += seconds * 1000; return changes.map(c => c.level); };
  assert.deepEqual(phase(40, 4), [2]);        // High fails once
  assert.deepEqual(phase(1000 / 60, 10), [3]); // retried after the delay
  assert.deepEqual(phase(40, 4), [2]);        // fails again
  assert.deepEqual(phase(1000 / 60, 60), []); // stays at Medium+
  assert.equal(auto.level, 2);
});

test('auto quality steps down on frequent stutters even when the average looks fine, but never below Medium for them', () => {
  // Every 25th frame misses a 60 Hz refresh: 4% stutters, about 58 fps on average.
  const stuttering = createAutoQuality({ start: 3, max: 3 });
  const levels = [];
  for (let i = 0, now = 0; i < 4000; i++) { const ms = i % 25 === 0 ? 33.3 : 16.7; now += ms; const next = stuttering.sample(ms, now); if (next !== null) levels.push(next); }
  assert.deepEqual(levels, [2, 1]);
  // An occasional stutter (under 3%) is tolerated, and so is a 120 Hz screen
  // that sometimes takes two refreshes (still well over 50 fps).
  for (const [every, fast, slow] of [[60, 16.7, 33.3], [30, 8.3, 16.6]]) {
    const auto = createAutoQuality({ start: 3, max: 3 });
    for (let i = 0, now = 0; i < 4000; i++) { const ms = i % every === 0 ? slow : fast; now += ms; assert.equal(auto.sample(ms, now), null); }
  }
});

test('stutter detection follows the display refresh rate', () => {
  assert.ok(Math.abs(refreshInterval([16.7, 16.6, 33.4, 16.7, 16.8, 16.7, 16.6, 16.7, 16.7, 16.7]) - 16.6) < .01);
  assert.ok(isSlowFrame(33.3, 16.7) && !isSlowFrame(18, 16.7));
  assert.ok(!isSlowFrame(16.6, 8.3), 'a 60 fps frame on a 120 Hz screen is not a stutter');
  assert.ok(isSlowFrame(25, 8.3));
});

test('auto quality settles at the lowest level on a device locked at 30 fps', () => {
  const auto = createAutoQuality({ start: 3, max: 3 });
  drive(auto, 1000 / 30, 30);
  assert.equal(auto.level, 0);
});

test('steering slider: dead zone, full lock at the rim, sensitivity curve', () => {
  assert.equal(steerAxis(0), 0); assert.equal(steerAxis(.05), 0);
  assert.equal(steerAxis(1), -1); assert.equal(steerAxis(-1), 1);
  for (const s of [.5, 1, 1.5]) assert.equal(steerAxis(-1, s), 1);
  const soft = steerAxis(-.4, .5), normal = steerAxis(-.4, 1), sharp = steerAxis(-.4, 1.5);
  assert.ok(soft < normal && normal < sharp);
});

test('analog input combines with digital keys and scales car acceleration', () => {
  assert.equal(controlAxis(undefined, true, false), 1);
  assert.equal(controlAxis(.4, false, false), .4);
  assert.equal(controlAxis(.6, true, false), 1);
  const world = createWorld(3);
  const run = input => { const car = createVehicle(world); for (let i = 0; i < 240; i++) stepVehicle(car, input, world, []); return car; };
  const full = run({ up: true }), analogFull = run({ throttle: 1 }), half = run({ throttle: .5 });
  assert.equal(analogFull.speed, full.speed);
  assert.ok(half.speed > full.speed * .4 && half.speed < full.speed * .6);
  const left = run({ up: true, left: true }), analogLeft = run({ throttle: 1, steer: 1 }), gentle = run({ throttle: 1, steer: .3 });
  assert.equal(analogLeft.heading, left.heading);
  assert.ok(gentle.heading > 0 && gentle.heading < left.heading);
});

test('Auto steps down even on machines too slow to fit 20 frames into its window', () => {
  for (const ms of [125, 200]) {
    const auto = createAutoQuality({ start: 3, max: 3 }); auto.reset(0);
    for (let now = ms; now < 30000; now += ms) auto.sample(ms, now);
    assert.equal(auto.level, 0, `${Math.round(1000 / ms)} fps`);
  }
});
