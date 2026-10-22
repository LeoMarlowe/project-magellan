// Tilt controls for phones: turn the phone like a steering wheel to steer (or
// roll in the air), tilt its top toward you to climb and away to dive. Pure
// logic (device angles in, control axes out), so it is unit-tested.
//
// Reads the deviceorientation angles beta and gamma, which iOS and Android
// report the same way (unlike raw accelerometer signs), and the screen's
// rotation, so the phone may be turned sideways either way round.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const RAD = Math.PI / 180;

// Full lock at 35° of wheel turn; climbing or diving fully at 25° of tilt.
export const WHEEL_RANGE = 35 * RAD, PITCH_RANGE = 25 * RAD;

// The direction of gravity in screen coordinates (x right, y up, z out of the
// screen toward you), from deviceorientation beta and gamma (degrees) and the
// screen's rotation (screen.orientation.angle: 0, 90, 180 or 270).
export function screenGravity(beta, gamma, screenAngle = 0) {
  const b = beta * RAD, g = gamma * RAD, s = screenAngle * RAD;
  // Down in device coordinates (x right, y toward the top, z out of the screen).
  const dx = Math.sin(g) * Math.cos(b), dy = -Math.sin(b), dz = -Math.cos(g) * Math.cos(b);
  // Turn into the screen's axes: with the content rotated by the screen
  // angle, the screen's right is device (cos, -sin) and its up (sin, cos).
  return [dx * Math.cos(s) - dy * Math.sin(s), dx * Math.sin(s) + dy * Math.cos(s), dz];
}

// wheel: how far the phone is turned like a steering wheel (radians,
// clockwise positive). lean: how far the screen is tilted back from upright
// (0 upright, π/2 lying flat face up). grip: 0–1, how well the wheel angle can
// be read (a phone lying flat has no up or down on its screen).
export function readTilt(beta, gamma, screenAngle = 0) {
  const [x, y, z] = screenGravity(beta, gamma, screenAngle), inPlane = Math.hypot(x, y);
  return { wheel: Math.atan2(x, -y), lean: Math.atan2(-z, inPlane), grip: smoothstep(.15, .4, inPlane) };
}

// Control deflections from a reading, as the slider and ring give them
// (steerAxis then adds the dead zone and sensitivity curve): wheel -1 (turned
// left) to 1 (right), like the slider; pitch like the ring's vertical, 1 (top
// tilted away: dive) to -1 (toward you: climb), from the lean relative to how
// the phone was held at neutral.
export function tiltAxes(tilt, neutralLean) {
  return {
    wheel: clamp(tilt.wheel / WHEEL_RANGE, -1, 1) * tilt.grip,
    // Tilting the top away (leaning back more) is pushing the stick forward.
    pitch: clamp((tilt.lean - neutralLean) / PITCH_RANGE, -1, 1) * tilt.grip,
  };
}
