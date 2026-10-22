import test from 'node:test';
import assert from 'node:assert/strict';
import { screenGravity, readTilt, tiltAxes, WHEEL_RANGE, PITCH_RANGE } from '../tilt.mjs';

const RAD = Math.PI / 180;
// The deviceorientation beta and gamma a phone reports when held with its
// screen turned clockwise by `wheel` and tilted back by `lean`, with the
// screen rotated by `angle`. Kept in the spec's ranges (gamma −90…90), as
// real phones report them.
function orientation(wheel, lean, angle) {
  const down = [Math.sin(wheel) * Math.cos(lean), -Math.cos(wheel) * Math.cos(lean), -Math.sin(lean)];
  const s = angle * RAD, right = [Math.cos(s), -Math.sin(s)], up = [Math.sin(s), Math.cos(s)];
  const dx = down[0] * right[0] + down[1] * up[0], dy = down[0] * right[1] + down[1] * up[1], dz = down[2];
  let beta = Math.asin(Math.max(-1, Math.min(1, -dy))), gamma = Math.atan2(dx, -dz);
  if (gamma >= Math.PI / 2 || gamma < -Math.PI / 2) { beta = Math.PI - beta; gamma += gamma > 0 ? -Math.PI : Math.PI; }
  return [beta / RAD, gamma / RAD];
}

test('gravity points down the screen when a phone is held upright, and into it when lying flat', () => {
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(near(screenGravity(90, 0, 0), [0, -1, 0]), 'portrait, upright');
  assert.ok(near(screenGravity(0, -90, 90), [0, -1, 0]), 'landscape (top on the left), upright');
  assert.ok(near(screenGravity(0, 90, 270), [0, -1, 0]), 'landscape (top on the right), upright');
  assert.ok(near(screenGravity(0, 0, 90), [0, 0, -1]), 'flat on a table');
});

test('the wheel angle and lean read back for every screen rotation, either way up', () => {
  for (const angle of [0, 90, 180, 270]) for (const wheel of [-30, -8, 0, 12, 34]) for (const lean of [0, 25, 45, 60]) {
    const reading = readTilt(...orientation(wheel * RAD, lean * RAD, angle), angle);
    assert.ok(Math.abs(reading.wheel / RAD - wheel) < 1e-6, `wheel ${wheel} at ${angle}°: ${reading.wheel / RAD}`);
    assert.ok(Math.abs(reading.lean / RAD - lean) < 1e-6, `lean ${lean} at ${angle}°: ${reading.lean / RAD}`);
    assert.equal(reading.grip, 1);
  }
});

test('turning right steers right, tilting away dives, and a flat phone steers nothing', () => {
  const held = readTilt(...orientation(0, 40 * RAD, 90), 90);
  const right = tiltAxes(readTilt(...orientation(20 * RAD, 40 * RAD, 90), 90), held.lean);
  assert.ok(Math.abs(right.wheel - 20 * RAD / WHEEL_RANGE) < 1e-9 && right.wheel > 0, 'clockwise is right, like the slider');
  assert.equal(tiltAxes(readTilt(...orientation(-80 * RAD, 40 * RAD, 90), 90), held.lean).wheel, -1, 'full lock past the range');
  assert.ok(Math.abs(tiltAxes(held, held.lean).pitch) < 1e-9, 'held as at the start: level');
  const away = tiltAxes(readTilt(...orientation(0, 55 * RAD, 90), 90), held.lean), toward = tiltAxes(readTilt(...orientation(0, 25 * RAD, 90), 90), held.lean);
  assert.ok(Math.abs(away.pitch - 15 * RAD / PITCH_RANGE) < 1e-9, 'top away: dive (like the ring pushed down)');
  assert.ok(toward.pitch < 0, 'top toward you: climb');
  const flat = readTilt(...orientation(30 * RAD, 89 * RAD, 90), 90);
  assert.ok(flat.grip < .01 && Math.abs(tiltAxes(flat, held.lean).wheel) < .01, 'lying flat, the wheel angle means nothing');
});
