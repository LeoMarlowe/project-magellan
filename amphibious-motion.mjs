import { waterWave } from './lakes.mjs?v=classes-2';
import { controlAxis } from './controls.mjs?v=slider-1';
export const TRANSFORM_SECONDS = 2.4;
export const BOAT_ENTER_DEPTH = .9;
export const BOAT_EXIT_DEPTH = .4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Hysteresis prevents repeated transforms when waves skim the same shoreline.
// Buoyancy begins at contact, independently of how far the panels have unfolded.
export function stepAmphibious(car, input, world, dt, groundAt) {
  car.time += dt;
  const water = world.waterAt?.(car.x, car.z);
  const touching = Boolean(water && car.y < water.level + .2);
  car.waterDepth = water?.depth ?? 0; car.waterLevel = water?.level ?? null;
  const requested = touching && water.depth > (car.boatMode ? BOAT_EXIT_DEPTH : BOAT_ENTER_DEPTH);
  if (requested && !car.boatMode) car.transformations++;
  car.boatMode = requested;
  car.transform = clamp(car.transform + (requested ? 1 : -1) * dt / TRANSFORM_SECONDS, 0, 1);
  const wasFloating = car.floating;
  car.floating = touching && water.depth > .55 && (requested || car.transform > 0);
  if (!car.floating) return false;
  // Water arrests a ramp landing before the cabin can plunge below the surface.
  if (!wasFloating) car.vy = Math.max(-2, car.vy);

  const oldX = car.x, oldZ = car.z;
  const throttle = controlAxis(input.throttle, input.up, input.down);
  const forwardX = Math.sin(car.heading), forwardZ = Math.cos(car.heading);
  const forward = car.vx * forwardX + car.vz * forwardZ;
  car.steer += (controlAxis(input.steer, input.left, input.right) - car.steer) * (1 - Math.exp(-6 * dt));
  const thrust = Math.abs(throttle) * (throttle > 0 ? (forward < -.4 ? 14 : 10) : throttle < 0 ? (forward > .4 ? -17 : -5) : 0);
  const deployed = .35 + .65 * car.transform;
  car.vx += forwardX * thrust * deployed * dt; car.vz += forwardZ * thrust * deployed * dt;
  car.heading += car.steer * .83 * Math.min(1, Math.abs(forward) / 3) * Math.sign(forward || 1) * dt;
  const nx = Math.sin(car.heading), nz = Math.cos(car.heading), along = car.vx * nx + car.vz * nz;
  const slip = Math.exp(-2.2 * dt);
  car.vx = nx * along + (car.vx - nx * along) * slip;
  car.vz = nz * along + (car.vz - nz * along) * slip;
  const drag = Math.exp(-(.28 + Math.hypot(car.vx, car.vz) * .024 + (input.brake ? 2 : 0)) * dt);
  car.vx *= drag; car.vz *= drag;
  if (!throttle && Math.hypot(car.vx, car.vz) < .06) car.vx = car.vz = 0;
  car.x += car.vx * dt; car.z += car.vz * dt;

  const support = groundAt(world, car.x, car.z, car.heading, car.y);
  const nextWater = world.waterAt?.(car.x, car.z);
  const level = nextWater?.level ?? water.level;
  const target = Math.max(support.y, level - .52 + waterWave(car.x, car.z, car.time));
  car.vy += ((target - car.y) * 49 - car.vy * 14) * dt;
  car.y = Math.max(support.y, car.y + car.vy * dt);
  car.groundY = support.y; car.grounded = false; car.onRoad = false;
  car.rollVelocity = 0; car.coyote = 0; car.jumpBuffer = 0; car.jumpHeld = !!input.jump;
  car.landLock = .1;
  const pitch = -.025 - Math.min(Math.abs(along), 20) * .004 + Math.sin(car.time * 1.8) * .012;
  const roll = -car.steer * Math.min(Math.abs(along) / 20, 1) * .1 + Math.sin(car.time * 1.3) * .018;
  car.pitch += (pitch - car.pitch) * (1 - Math.exp(-4 * dt));
  car.roll = Math.atan2(Math.sin(car.roll), Math.cos(car.roll));
  car.roll += (roll - car.roll) * (1 - Math.exp(-5 * dt));
  car.impact *= Math.exp(-8 * dt);
  car.speed = car.vx * nx + car.vz * nz;
  const travelled = Math.hypot(car.x - oldX, car.z - oldZ);
  car.distance += travelled; car.boatDistance += travelled;
  // Floating is not airtime and must not award a jump for crossing a lake.
  car.airtime = 0; car.airDistance = 0; car.airRoll = 0;
  return true;
}
