// Arcade flight for the transforming ATLAS: deterministic fixed-step motion
// shared by the game and the tests, with no renderer required.
import { waterWave } from './lakes.mjs?v=classes-2';
import { controlAxis } from './controls.mjs?v=slider-1';
export const FLIGHT_TRANSFORM_SECONDS = 1.6;
export const TAKEOFF_SPEED = 32; // m/s, 115 km/h: the propeller lifts it off here
export const STALL_SPEED = 26; // m/s; level flight is impossible below this
export const MAX_AIRSPEED = 95; // m/s, about 340 km/h: full throttle in level flight
export const CEILING = 650; // metres above sea level: thin air above this
// Aerodynamics per unit mass (m/s²). Lift = LIFT·ρ·v²·CL(α) at right angles to
// the airflow, toward the plane's own "up"; drag = (DRAG + INDUCED·CL²)·ρ·v².
// Tuned so full throttle levels out near 95 m/s with thrust a little under
// the plane's weight, and the wing stalls past 16° (below ~26 m/s level).
const LIFT = .0085, CL0 = .25, CL_SLOPE = 5, STALL_ANGLE = .28, DRAG = .001, INDUCED = .0006, SIDE = .003;
const MAX_THRUST = 9, MAX_LOAD = 50, NEVER_EXCEED = 140;
export function liftCoefficient(alpha) {
  const peak = CL0 + CL_SLOPE * STALL_ANGLE, trough = CL0 - CL_SLOPE * STALL_ANGLE;
  if (alpha > STALL_ANGLE) return Math.max(.3, peak * (1 - (alpha - STALL_ANGLE) * 2.5));
  if (alpha < -STALL_ANGLE) return Math.min(-.3, trough * (1 - (-alpha - STALL_ANGLE) * 2.5));
  return CL0 + CL_SLOPE * alpha;
}
// Thinning air above 450 m weakens lift, thrust and control: the ceiling.
export const airDensity = y => 1 - .65 * smoothstep(450, 750, y) - .3 * smoothstep(650, 900, y);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const SAFE_ALTITUDE = 35; // hands-off climb-out height above the ground
// For this long after leaving the ground or water, a tail, nose or wingtip
// touching down is part of the take-off, not a crash.
export const TAKEOFF_GRACE = 3; // seconds
const BOAT_TRANSFORM_SECONDS = 2.4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const PITCH_RATE = 1.1, ROLL_RATE = 2.2, YAW_RATE = .35; // rad/s at full authority

// F toggles the request; the transformation and lift follow in fixed steps.
export function toggleFlight(car) { car.flightMode = !car.flightMode; return car.flightMode; }

// Flight axes. The game supplies dedicated keys (W/S throttle, ↑↓ or
// Space/Shift pitch, A/D or ←→ roll, Q/E yaw); anything else falls back to
// the driving inputs, so tests and simple controllers still fly.
export function flightAxes(input) {
  // Simple controls: the driving keys (W/↑ throttle, Space/Shift climb and
  // dive, A/D or ←/→ turn), also for the take-off run.
  if (input.simpleFlight) return { throttle: controlAxis(input.throttle, input.up, input.down), pitch: controlAxis(input.pitchAxis, input.jump, input.brake), roll: controlAxis(input.steer, input.left, input.right), yaw: 0 };
  return {
    throttle: controlAxis(input.throttle, input.throttleUp ?? input.up, input.throttleDown ?? input.down),
    // + nose up. pitchAxis is the touch ring's analog pitch (up climbs).
    pitch: controlAxis(input.pitchAxis, input.pitchUp ?? input.jump, input.pitchDown ?? input.brake),
    roll: controlAxis(input.steer, input.rollLeft ?? input.left, input.rollRight ?? input.right), // + left wing down
    yaw: Number(!!input.yawLeft) - Number(!!input.yawRight), // + nose left
  };
}

// Attitude is a quaternion (x, y, z, w) in the model frame: +z nose, +y mast,
// +x left wing. Body-axis rates make loops and barrel rolls possible; the
// heading, pitch and roll angles are derived from it for rendering and HUD.
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
function qAxis(x, y, z) {
  const angle = Math.hypot(x, y, z); if (angle < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2) / angle; return [x * s, y * s, z * s, Math.cos(angle / 2)];
}
export function rotate(q, v) {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
// Same convention as the renderer: Euler order YXZ (heading, pitch, roll), and
// a negative pitch raises the nose.
export function attitudeFromEuler(heading, pitch, roll) {
  const c1 = Math.cos(pitch / 2), c2 = Math.cos(heading / 2), c3 = Math.cos(roll / 2), s1 = Math.sin(pitch / 2), s2 = Math.sin(heading / 2), s3 = Math.sin(roll / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}
export function eulerFromAttitude([x, y, z, w]) {
  const m13 = 2 * (x * z + w * y), m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x), m33 = 1 - 2 * (x * x + y * y);
  const m11 = 1 - 2 * (y * y + z * z), m31 = 2 * (x * z - w * y);
  const pitch = Math.asin(-clamp(m23, -1, 1));
  return Math.abs(m23) < .9999999 ? { heading: Math.atan2(m13, m33), pitch, roll: Math.atan2(m21, m22) } : { heading: Math.atan2(-m31, m11), pitch, roll: 0 };
}
function setAttitude(car, q) {
  const n = Math.hypot(...q); [car.qx, car.qy, car.qz, car.qw] = q.map(v => v / n);
  Object.assign(car, eulerFromAttitude([car.qx, car.qy, car.qz, car.qw]));
}

// Simple flight controls (T toggles them; the game passes input.simpleFlight):
// the arcade scheme from before three-axis flight. Left/right bank the plane
// to turn and level the wings when released; climb/dive set the flight path,
// held level hands off; W/S (or ↑/↓) are the throttle. They fly through the
// same pitch and roll controls a pilot would, so the physics are unchanged.
// Turning also swings the flight path around the vertical, as the old arcade
// turn did, so a full turn takes about ten seconds even at top speed.
const SIMPLE_BANK = .75, SIMPLE_CLIMB = .45, SIMPLE_TURN = .5; // radians, radians, rad/s
function simpleAxes(car, input, world, dt) {
  const q = [car.qx, car.qy, car.qz, car.qw], mast = rotate(q, [0, 1, 0]), wing = rotate(q, [1, 0, 0]);
  const speed = car.airspeed || 1, bank = Math.atan2(wing[1], mast[1]); // + right wing down
  const turn = controlAxis(input.steer, input.left, input.right), climb = controlAxis(input.pitchAxis, input.jump, input.brake);
  // Hands off right after a take-off, it still climbs out to a safe height.
  if (climb) car.climbOut = false;
  const height = car.y - world.surface(car.x, car.z);
  let wanted = climb * SIMPLE_CLIMB;
  if (!climb && car.climbOut) { wanted = .22 * clamp((SAFE_ALTITUDE - height) / SAFE_ALTITUDE, 0, 1); if (!wanted) car.climbOut = false; }
  const path = Math.asin(clamp(car.vy / speed, -1, 1)), rate = car.assistPath == null ? 0 : (path - car.assistPath) / dt;
  car.assistPath = path;
  let error = bank + turn * SIMPLE_BANK; // turning left lowers the left wing (negative bank)
  error = Math.atan2(Math.sin(error), Math.cos(error));
  return {
    throttle: controlAxis(input.throttle, input.up, input.down),
    pitch: Math.abs(bank) < 1.4 ? clamp((wanted - path) * 6 - rate * 1.4, -1, 1) : 0, // upright first if inverted
    roll: clamp(error * 1.6, -1, 1),
    yaw: turn, // rudder into the turn
    turn,
  };
}

function startFlying(car, climb) {
  const horizontal = Math.hypot(car.vx, car.vz);
  car.flying = true; car.grounded = false; car.floating = false; car.boatMode = false;
  car.airspeed = Math.hypot(horizontal, car.vy);
  const angle = climb ?? clamp(Math.atan2(car.vy, Math.max(horizontal, 1)), -.5, .5);
  setAttitude(car, attitudeFromEuler(car.heading, -angle, car.roll));
  car.climb = angle; car.alpha = 0;
  car.sink = 0; car.coyote = 0; car.jumpBuffer = 0; car.airtime = 0; car.airDistance = 0; car.climbOut = false;
  car.flights++;
  car.takeoff = TAKEOFF_GRACE;
}

function retractHulls(car, dt) {
  car.transform = Math.max(0, car.transform - dt / BOAT_TRANSFORM_SECONDS);
  car.boatMode = false;
}

// Fully winged on the ground or the water: the propeller drives the car or the
// floating hull until it reaches lift-off speed.
function taxi(car, input, world, dt, groundAt) {
  const water = world.waterAt?.(car.x, car.z);
  const onWater = Boolean(water && water.depth > .55 && car.y < water.level + .3);
  const axes = flightAxes(input), throttle = axes.throttle, turn = clamp(axes.roll + axes.yaw, -1, 1), climbInput = axes.pitch;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const oldX = car.x, oldZ = car.z;
  let speed = car.vx * fx + car.vz * fz;
  speed += (throttle > 0 ? 16 * throttle : throttle < 0 ? 20 * throttle : 0) * dt;
  speed = clamp(speed * Math.exp(-(onWater ? .14 : .05) * dt), -6, MAX_AIRSPEED);
  car.steer += (turn - car.steer) * (1 - Math.exp(-8 * dt));
  car.heading += car.steer * .9 * Math.min(Math.abs(speed) / 6, 1) / (1 + Math.abs(speed) * .02) * Math.sign(speed || 1) * dt;
  const hx = Math.sin(car.heading), hz = Math.cos(car.heading);
  car.vx = hx * speed; car.vz = hz * speed; car.vy = 0;
  car.x += car.vx * dt; car.z += car.vz * dt;
  const g = groundAt(world, car.x, car.z, car.heading);
  const level = water?.level ?? 0;
  // On water the hull climbs onto the step as it nears lift-off speed, like a
  // seaplane: riding at its normal depth, the nose-up rotation for take-off
  // would dip the tail into the water and end the flight.
  const planing = smoothstep(.55, 1, Math.abs(speed) / TAKEOFF_SPEED) * .62;
  car.y = onWater ? Math.max(g.y, level - .52 + planing + waterWave(car.x, car.z, car.time)) : g.y;
  car.groundY = g.y; car.grounded = !onWater; car.floating = onWater; car.onRoad = false;
  car.waterDepth = water?.depth ?? 0; car.waterLevel = water?.level ?? null;
  car.pitch += ((onWater ? 0 : g.pitch) - car.pitch) * (1 - Math.exp(-10 * dt));
  car.roll += ((onWater ? 0 : g.roll) - car.roll) * (1 - Math.exp(-10 * dt));
  car.speed = speed; car.airspeed = Math.abs(speed); car.time += dt;
  car.distance += Math.hypot(car.x - oldX, car.z - oldZ);
  retractHulls(car, dt);
  // Rotate at lift-off speed (holding Climb a little sooner): the nose comes
  // up to a flying angle of attack, and the wings take the weight.
  // Pushing the nose down keeps it rolling on its wheels, however fast.
  if (climbInput >= 0 && speed > TAKEOFF_SPEED - (climbInput > 0 ? 4 : 0)) { startFlying(car, .03); car.vy = 1; rotateNose(car, -.16); car.climbOut = true; }
  return true;
}

function rotateNose(car, angle) { setAttitude(car, qMul([car.qx, car.qy, car.qz, car.qw], qAxis(angle, 0, 0))); }

// At flying speed a contact with ground or water is a bounce or a skim: the
// plane keeps flying, loses some speed, and is knocked back toward level
// (righted if it was rolled past 90°). Below lift-off speed it lands: on the
// ground as the car, on deep water as the boat, folding its wings as it goes.
// (A take-off run never comes through here: taxiing has its own physics.)
function touchdown(car, ground, water) {
  if (!car.flightMode) { land(car, ground, water); return; }
  // Settling back while still trying to take off: keep the wings and taxi on.
  if (car.takeoff > 0 && car.airspeed < TAKEOFF_SPEED) { backToTaxi(car, ground, water); return; }
  const descent = -car.vy;
  car.impact = Math.max(car.impact, clamp(descent * .02, .05, .3));
  // A gentle touch with the nose pushed down settles onto the wheels (or the
  // hull) and rolls on with the wings out, instead of skipping along the
  // ground; easing off lets it lift off again.
  if (descent < 4 && car.pushingDown) { backToTaxi(car, ground, water); return; }
  if (car.airspeed >= TAKEOFF_SPEED) {
    const hard = descent > 7;
    car.y = ground + .05;
    car.vy = hard ? Math.min(descent * .3, 6) : Math.max(car.vy, 0);
    const scrub = hard ? .82 : .97; car.vx *= scrub; car.vz *= scrub;
    // Deflected by the ground: never pointing into it, never upside down.
    const nose = rotate([car.qx, car.qy, car.qz, car.qw], [0, 0, 1]), mast = rotate([car.qx, car.qy, car.qz, car.qw], [0, 1, 0]);
    if (nose[1] < 0 || mast[1] < 0) setAttitude(car, attitudeFromEuler(Math.atan2(car.vx, car.vz), -.05, mast[1] < 0 ? 0 : car.roll));
    car.airspeed = Math.hypot(car.vx, car.vy, car.vz); car.climb = Math.asin(clamp(car.vy / (car.airspeed || 1), -1, 1));
    return;
  }
  land(car, ground, water);
}

// Back on the ground (or water) with the wings still out: the take-off run
// carries on from here.
function backToTaxi(car, ground, water) {
  const floating = Boolean(water && water.depth > .55);
  car.flying = false; car.y = floating ? Math.max(ground, water.level - .52) : ground; car.vy = 0;
  car.grounded = !floating; car.floating = floating; car.climb = 0; car.sink = 0; car.takeoff = 0; car.shadow = 0; car.shadowVy = 0;
  car.airtime = 0; car.airDistance = 0; car.rollVelocity = 0; car.climbOut = false;
  setAttitude(car, attitudeFromEuler(car.heading, 0, 0));
}

function land(car, ground, water) {
  const descent = -car.vy;
  car.flying = false; car.flightMode = false; car.sink = 0; car.climb = 0;
  car.y = ground; car.vy = 0; car.airtime = 0; car.airDistance = 0; car.rollVelocity = 0;
  car.impact = Math.max(car.impact, clamp(descent * .02, 0, .3));
  // A steep or fast arrival scrubs speed, but the car always lands drivable.
  if (descent > 9) { car.vx *= .55; car.vz *= .55; }
  car.roll = Math.atan2(Math.sin(car.roll), Math.cos(car.roll));
  if (water) {
    car.floating = true; car.grounded = false; car.waterDepth = water.depth; car.waterLevel = water.level;
  } else { car.grounded = true; car.landLock = .1; car.coyote = .1; car.shadow = 0; car.shadowVy = 0; }
}

function fly(car, input, world, dt, groundAt) {
  const simple = Boolean(input.simpleFlight);
  if (!simple) car.assistPath = null;
  const { throttle, pitch, roll, yaw, turn: arcadeTurn = 0 } = simple ? simpleAxes(car, input, world, dt) : flightAxes(input);
  car.pushingDown = (simple ? controlAxis(input.pitchAxis, input.jump, input.brake) : pitch) < -.25; // the pilot, not the simple controls' own trim
  const wings = car.flight, oldX = car.x, oldZ = car.z;
  const below = groundAt(world, car.x, car.z, car.heading).y;
  let q = [car.qx, car.qy, car.qz, car.qw];
  const nose = rotate(q, [0, 0, 1]), mast = rotate(q, [0, 1, 0]), wing = rotate(q, [1, 0, 0]);
  const v = [car.vx, car.vy, car.vz], speed = Math.hypot(...v), dir = speed > 1e-3 ? v.map(c => c / speed) : nose;
  // Airflow in the plane's frame: angle of attack (nose above the flight path
  // is positive) and sideslip.
  const along = Math.max(dot(v, nose), 1e-3), alpha = Math.atan2(-dot(v, mast), along), beta = Math.atan2(dot(v, wing), along);
  const rho = airDensity(car.y), pressure = rho * speed * speed;
  const cl = liftCoefficient(alpha) * wings; // folded wings give no lift
  // Lift at right angles to the airflow, toward the plane's "up": upside down
  // it pulls toward the ground. Loads are limited to about 5 g.
  const across = mast.map((c, k) => c - dir[k] * dot(mast, dir)), length = Math.hypot(...across) || 1;
  const lift = clamp(LIFT * pressure * cl, -MAX_LOAD, MAX_LOAD);
  // Thrust only while W is held; S opens air brakes. Hands off, it glides.
  const thrust = MAX_THRUST * Math.max(0, throttle) * rho * (.4 + .6 * wings);
  const drag = (DRAG * (1 + 2.5 * Math.max(0, -throttle)) + INDUCED * cl * cl) * pressure, slip = SIDE * pressure * beta;
  for (let k = 0; k < 3; k++) v[k] += (nose[k] * thrust + across[k] / length * lift - dir[k] * drag - wing[k] * slip + (k === 1 ? -9.8 : 0)) * dt;
  const fast = Math.hypot(...v); if (fast > NEVER_EXCEED) for (let k = 0; k < 3; k++) v[k] *= NEVER_EXCEED / fast;
  // Controls: body-axis rates. Their bite grows with airspeed and air density.
  const authority = (.35 + .65 * wings) * clamp(speed / 30, .3, 1) * Math.sqrt(rho);
  const bank = Math.atan2(wing[1], mast[1]); // 0 level, + right wing down, ±π inverted
  let pitchRate = pitch * PITCH_RATE, rollRate = -roll * ROLL_RATE, yawRate = yaw * YAW_RATE;
  // Released controls leave the attitude alone: no wing levelling, no pull
  // up. The only exception is the climb-out right after a take-off from the
  // ground or water: hands off, the nose comes up to about 35 m and levels.
  // Any pitch input, or reaching that height, ends it for the rest of the flight.
  const height = car.y - below, pathAngle = Math.asin(clamp(dir[1], -1, 1));
  // (The simple controls run their own climb-out.)
  if (!simple) {
    if (pitch || mast[1] < .5) car.climbOut = false;
    else if (car.climbOut && height < SAFE_ALTITUDE) {
      const target = .22 * clamp((SAFE_ALTITUDE - height) / SAFE_ALTITUDE, 0, 1);
      if (target > pathAngle) pitchRate = (target - pathAngle) * 2.5 + .3;
    } else if (car.climbOut && height < SAFE_ALTITUDE * 2) {
      pitchRate = -pathAngle * 1.5;
      if (Math.abs(pathAngle) < .02) car.climbOut = false;
    } else car.climbOut = false;
  }
  q = qMul(q, qAxis(-pitchRate * authority * dt, yawRate * authority * dt, rollRate * authority * dt));
  // Rudder: the nose yaws about the plane's own up axis, and on the full
  // controls the flight path swings round with it (a flat, skidding turn that
  // bleeds a little speed). Left to the aerodynamics alone, the tail would
  // weathervane the nose straight back and the plane would only crab.
  if (yawRate && !simple) {
    const swing = yawRate * authority * dt, [mx, my, mz] = mast, c = Math.cos(swing), sn = Math.sin(swing), along = v[0] * mx + v[1] * my + v[2] * mz;
    const [vx, vy, vz] = v, cx = my * vz - mz * vy, cy = mz * vx - mx * vz, cz = mx * vy - my * vx;
    v[0] = vx * c + cx * sn + mx * along * (1 - c); v[1] = vy * c + cy * sn + my * along * (1 - c); v[2] = vz * c + cz * sn + mz * along * (1 - c);
    const bleed = 1 - .12 * Math.abs(yaw) * dt; for (let k = 0; k < 3; k++) v[k] *= bleed;
  }
  // Stability and trim: the tail swings the nose back toward the angle of
  // attack at which lift balances weight on the current flight path (and,
  // upright, in the current bank). Hands off, the plane holds its path; slow,
  // the trim angle passes the stall and the nose drops; upside down, the same
  // trimmed lift points at the ground, so it dives unless pushed.
  const turn = [0, 0, 0];
  if (speed > 1) {
    const upright = Math.cos(bank) > 0, unitAcross = across.map(c => c / length);
    const needed = 9.8 * Math.cos(pathAngle) / (upright ? Math.max(Math.cos(bank), .5) : 1);
    const trim = clamp((needed / Math.max(LIFT * pressure * wings, 1e-3) - CL0) / CL_SLOPE, -.15, STALL_ANGLE - .03);
    const target = dir.map((c, k) => c * Math.cos(trim) + unitAcross[k] * Math.sin(trim));
    const axis = cross(nose, target), sine = Math.hypot(...axis);
    if (sine > 1e-6) {
      const angle = Math.atan2(sine, dot(nose, target)), stability = 2.2 * clamp(speed / 30, .3, 2) * (.5 + .5 * wings) * rho;
      const step = angle * Math.min(1, stability * dt) / sine;
      q = qMul(qAxis(axis[0] * step, axis[1] * step, axis[2] * step), q);
    }
  }
  if (arcadeTurn) {
    const swing = arcadeTurn * SIMPLE_TURN * authority * dt, c = Math.cos(swing), sn = Math.sin(swing);
    [v[0], v[2]] = [v[0] * c + v[2] * sn, -v[0] * sn + v[2] * c];
    q = qMul(qAxis(0, swing, 0), q);
  }
  setAttitude(car, q);
  [car.vx, car.vy, car.vz] = v;
  car.x += v[0] * dt; car.y += v[1] * dt; car.z += v[2] * dt;
  car.airspeed = Math.hypot(...v); car.speed = Math.hypot(v[0], v[2]); car.alpha = alpha;
  car.climb = Math.asin(clamp(v[1] / (car.airspeed || 1), -1, 1));
  car.steer += (0 - car.steer) * (1 - Math.exp(-8 * dt)); car.time += dt;
  const travelled = Math.hypot(car.x - oldX, car.z - oldZ);
  car.distance += travelled; car.flightDistance += travelled; car.airtime += dt;
  car.takeoff = Math.max(0, (car.takeoff || 0) - dt);
  retractHulls(car, dt);
  const water = world.waterAt?.(car.x, car.z), deep = water && water.depth > .9 ? water : null;
  const g = groundAt(world, car.x, car.z, car.heading);
  const ground = deep ? Math.max(g.y, water.level - .52) : g.y;
  car.groundY = g.y; car.waterDepth = water?.depth ?? 0; car.waterLevel = water?.level ?? null;
  car.maxAltitude = Math.max(car.maxAltitude, car.y - g.y);
  if (car.y <= ground) touchdown(car, ground, deep);
  else if (car.flying) scrape(car, world);
  return true;
}

// The plane's extremities, in model coordinates (+x left wing, +y up, +z
// nose; the model origin is at the wheels' contact plane). The wingtips move
// out as the wings telescope.
const PIVOT = 1; // the renderer rotates the model about (0, 1, 0)
function extremities(car) {
  const span = 1 + 2.75 * smoothstep(0, 1, car.flight);
  return [{ p: [span, 1.18, -.2], side: 1 }, { p: [-span, 1.18, -.2], side: -1 },
    { p: [.92, 2.42, -4.3], tail: true }, { p: [-.92, 2.42, -4.3], tail: true }, { p: [0, 1.46, -4.4], tail: true }, { p: [0, .98, 2.9], nose: true }];
}
// Lowest clearance of the wings, tail and propeller over ground or water
// (negative when buried). Exported for tests.
export function wingClearance(car, world) {
  const q = [car.qx, car.qy, car.qz, car.qw];
  let lowest = { depth: -Infinity };
  for (const point of extremities(car)) {
    const r = rotate(q, [point.p[0], point.p[1] - PIVOT, point.p[2]]);
    const x = car.x + r[0], y = car.y + PIVOT + r[1], z = car.z + r[2];
    const water = world.waterAt?.(x, z), floor = water ? water.level : world.surface(x, z);
    if (floor - y > lowest.depth) lowest = { depth: floor - y, point };
  }
  return lowest;
}
// A wingtip, tail or propeller touching the ground (or water) ends the
// flight: the wings fold and it falls the rest of the way as the car, and
// lands with the normal car (or, in deep water, boat) physics. It is lifted
// just clear first, so nothing is left buried in the terrain.
function scrape(car, world) {
  const { depth, point } = wingClearance(car, world);
  if (!(depth > 0)) return;
  car.y += depth;
  // During the take-off a tail (over-rotating), nose or wingtip touching the
  // ground or water is shrugged off: lifted clear and nudged level (a wingtip
  // rolls away from a sloping hillside), flying on, or back to the take-off
  // run if it is too slow to fly. Afterwards, a wingtip touch ends the flight.
  if (car.takeoff > 0) {
    car.vy = Math.max(car.vy, 0); car.impact = Math.max(car.impact, .08);
    if (car.airspeed < TAKEOFF_SPEED) { backToTaxi(car, car.y, world.waterAt?.(car.x, car.z)); return; }
    if (point.side) setAttitude(car, qMul([car.qx, car.qy, car.qz, car.qw], qAxis(0, 0, point.side * .05)));
    else rotateNose(car, point.tail ? .04 : -.04);
    return;
  }
  car.flying = false; car.flightMode = false; car.grounded = false; car.floating = false;
  car.vx *= .9; car.vz *= .9; car.vy = Math.min(car.vy, 0);
  car.airtime = 0; car.airDistance = 0; car.rollVelocity = 0; car.landLock = 0; car.coyote = 0;
  car.impact = Math.max(car.impact, .3); car.wingCrashes = (car.wingCrashes || 0) + 1; car.crashFold = true;
}

// Returns true when it moved the car this tick. Otherwise the car or boat
// physics run as usual (while the wings unfold on the ground, or fold away).
export function stepFlight(car, input, world, dt, groundAt) {
  // After a wingtip strike the wings snap shut much faster than a normal fold.
  car.flight = clamp(car.flight + (car.flightMode ? dt : -dt * (car.crashFold ? 3.5 : 1)) / FLIGHT_TRANSFORM_SECONDS, 0, 1);
  if (car.flight === 0 || car.flightMode) car.crashFold = false;
  if (!car.flying) {
    // A jumping car with its wings half out starts to glide. A bump that
    // barely lifts the wheels is still driving: only a real jump (well clear
    // of the ground, or in the air a while) becomes flight, so the hop's
    // landing is not taken for a touchdown that folds the wings.
    const clear = !car.grounded && !car.floating && (car.y - groundAt(world, car.x, car.z, car.heading).y > 1.2 || car.airtime > .45);
    if (car.flightMode && car.flight >= .35 && clear) startFlying(car);
    else if (car.flightMode && car.flight === 1) { car.impact *= Math.exp(-8 * dt); return taxi(car, input, world, dt, groundAt); }
    else return false;
  }
  // A knock fades here as it does on the road and the water. Held instead,
  // the one the car took off with read as a fresh knock (a thump) whenever a
  // frame ran long: after a pause, a hitch, or on a slower phone.
  car.impact *= Math.exp(-8 * dt);
  return fly(car, input, world, dt, groundAt);
}

// Wings against scenery. Each wing is a segment from its root to its tip
// (telescoped to the current span), tested against trees, cacti, rocks and
// boulders at the height it is actually flying. Breakable props shatter
// through the usual breakage events. The struck wing is dragged back: the
// plane yaws toward that side, drops that wing and loses speed, more for a
// strike near the tip and for heavier objects. An unbroken boulder shoves the
// plane away. Returns the number of strikes this step.
const WING_REACH = { tree: 1.25, cactus: .8, rock: .55, boulder: 1.5 }; // × prop size: canopy, not trunk
const STRIKE = { tree: { scrub: .93, yaw: .16, roll: .22 }, cactus: { scrub: .96, yaw: .08, roll: .1 },
  rock: { scrub: .95, yaw: .1, roll: .14 }, boulder: { scrub: .8, yaw: .3, roll: .35 } };
function worldPoint(car, q, p) {
  const r = rotate(q, [p[0], p[1] - PIVOT, p[2]]);
  return [car.x + r[0], car.y + PIVOT + r[1], car.z + r[2]];
}
export function wingStrikes(car, obstacles, world) {
  if (car.flight < .3 || !obstacles?.length) return 0; // flying or taxiing with the wings out
  const span = 1 + 2.75 * smoothstep(0, 1, car.flight);
  let strikes = 0;
  for (const side of [1, -1]) { // +1 is the left wing (+x)
    const q = [car.qx, car.qy, car.qz, car.qw];
    const root = worldPoint(car, q, [side, 1.18, -.2]), tip = worldPoint(car, q, [side * span, 1.18, -.2]);
    const dx = tip[0] - root[0], dz = tip[2] - root[2], length2 = dx * dx + dz * dz || 1e-9;
    for (const o of obstacles) {
      const reach = (WING_REACH[o.type] ?? 0) * (o.size || 1);
      if (!reach || world.brokenProps?.has(o.id)) continue;
      const t = clamp(((o.x - root[0]) * dx + (o.z - root[2]) * dz) / length2, 0, 1);
      const px = root[0] + dx * t, pz = root[2] + dz * t, py = root[1] + (tip[1] - root[1]) * t;
      // A pine's canopy is a cone: a wing passing over its tip misses it.
      const up = clamp((py - o.y) / (o.h || 1), 0, 1), canopy = o.type === 'tree' ? reach * Math.min(1, 1.3 * (1 - up)) : reach;
      const gap = Math.hypot(px - o.x, pz - o.z);
      if (gap > canopy || py < o.y - .3 || py > o.y + o.h) continue;
      const speed = Math.hypot(car.vx, car.vy, car.vz), heavy = o.type === 'boulder';
      const broke = speed >= (heavy ? 26 : 12) && Boolean(world.breakProp);
      if (broke) world.breakProp(o, car.vx, car.vz);
      const effect = STRIKE[o.type], lever = (1 + t * (span - 1)) / span; // 0 at the body, 1 at the tip
      const scrub = broke ? effect.scrub : Math.min(effect.scrub, .7);
      car.vx *= scrub; car.vz *= scrub; car.vy *= scrub;
      // The drag on one wing swings the nose toward it and drops that wing.
      const yaw = side * effect.yaw * lever * (broke ? 1 : 1.6), roll = -side * effect.roll * lever * (broke ? 1 : 1.6);
      setAttitude(car, qMul(q, qAxis(0, yaw, roll)));
      const turn = yaw * .5, c = Math.cos(turn), sn = Math.sin(turn); // the flight path bends a little too
      [car.vx, car.vz] = [car.vx * c + car.vz * sn, -car.vx * sn + car.vz * c];
      if (!broke) { // shoved clear of an unbroken boulder
        const away = Math.hypot(px - o.x, pz - o.z) || 1, push = canopy - gap + .05;
        car.x += (px - o.x) / away * push; car.z += (pz - o.z) / away * push;
      }
      car.impact = Math.max(car.impact, heavy ? .3 : .18);
      car.airspeed = Math.hypot(car.vx, car.vy, car.vz); car.wingStrikes = (car.wingStrikes || 0) + 1; strikes++;
      car.lastStrike = { x: px, z: pz, heavy: heavy && !broke }; // where it hit, for the sound
      break; // one strike per wing per step; the attitude has changed
    }
  }
  return strikes;
}
