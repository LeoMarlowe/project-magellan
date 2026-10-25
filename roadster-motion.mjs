// The Roadster (Rocket trim): handling from its published figures, and its
// cold-gas thrusters. Shared by the game and the tests, with no renderer.
//
// Figures (Tesla's October 2026 reveal and reporting on it): over 1 MW and a
// target mass under 1,700 kg; 0–60 mph in under 1.6 s on the tyres (the
// Performance trim, with the same suction fans) and under 0.59 s with the
// Rocket's thrusters; over 230 mph (370 km/h); 600 L of gas at about 690 bar
// for 5–6 s of thrust; ten nozzles: four in the rear diffuser for forward
// thrust, four at the corners for lift and two on the flanks for yaw.
import { clamp, mix, smoothstep } from './noise.mjs?v=terrain-1';
export const MPH60 = 26.8224; // m/s
export const ROADSTER = {
  wheelRadius: .355, // mean of the 295/30 R20 (0.343 m) and 335/30 R21 (0.367 m) tyres
  launch: 17.1, // m/s² of tyre grip: 0–60 mph in 1.6 s once drag is counted
  power: 1e6 / 1700, // W/kg: power-limited above about 125 km/h
  topSpeed: 370 / 3.6, // m/s on tarmac, where power meets drag
  boost: 28.7, // m/s² from the four rear thrusters: 0–60 mph in 0.59 s with the tyres
  speedLimit: 402 / 3.6, // m/s (250 mph, the 2017 claim): the boost's ceiling
  tank: 5.5, // seconds of thrust from one group of nozzles per fill
  refill: 25, // seconds to refill while driving (a game allowance; a real fill takes hours)
  lift: 44, // m/s² from the corner nozzles at full thrust: twice the game's gravity
  hoverHeight: 5, // m: held F settles at this height above the ground or water
  climbRate: 8, // m/s: the fastest it rises toward that height, or sinks from above it
  yawRate: 1.6, // rad/s from the flank nozzles while hovering, at any speed
  waterGap: .35, // m: the thrusters hold the car this far above water
  waterThrust: 10, // m/s² across water: the rear nozzles idle along, using no gas
};
// The multi-mode suction fans pull air from under the car on land ("enough
// suction to hold the vehicle upside down"): the tyres keep their grip on
// faces up to about 70° and through corners the ATLAS would slide out of, and
// the car stays down over crests. Off on water, where the thrusters hold it,
// and when the driver switches them off (car.fans): then the tyres grip as
// any car's do, and it leaves crests and climbs like the ATLAS.
export const SUCTION = {
  climbLoss: .2, // of the ATLAS's loss of power on a climb
  slopePull: .3, // of the ATLAS's slide back down a slope
  grassGrip: .85, // tyre grip on grass, of tarmac's (.6 without the fans)
  stall: [2.4, 3.6], // the uphill push fades from 67° to 75° (the ATLAS: 37–50°)
  wall: 3, // gradient of a face that stops the car: 72° (the ATLAS: 52°)
  turn: 2.4, turnBrake: 2.6, turnFade: .02, // steering rate (the ATLAS: 1.7, 2.1, .032)
  grip: { road: 24, dirt: 14, grass: 16 }, // side grip (the ATLAS: 12, 6.5, 8)
  crestHold: .25, // of its climbing speed it keeps leaving the land's crests (not ramps)
};
// Per-second drag: rolling and surface drag ∝ v, aero ∝ v². Aero is set so
// that power meets drag at 370 km/h on tarmac; grass tops out near 180 km/h,
// dirt near 250 km/h and water near 160 km/h.
const DRAG = { road: .01, dirt: .089, grass: .213, water: .2, brake: 1.6 };
export const AERO = (ROADSTER.power / ROADSTER.topSpeed - DRAG.road * ROADSTER.topSpeed) / ROADSTER.topSpeed ** 2;
export const GRAVITY = 22; // the game's arcade gravity, as in world.mjs

// The world as the Roadster's thrusters see it: water is a surface they hold
// it above. Cached per world, so the view is made once.
const views = new WeakMap();
export function hoverWorld(world) {
  let view = views.get(world);
  if (!view) {
    const surface = (x, z, y) => {
      const ground = world.surface(x, z, y), water = world.waterAt?.(x, z);
      return water ? Math.max(ground, water.level + ROADSTER.waterGap) : ground;
    };
    view = Object.assign(Object.create(world), { surface, gradient: (x, z) => ({ x: (surface(x + 2, z) - surface(x - 2, z)) / 4, z: (surface(x, z + 2) - surface(x, z - 2)) / 4 }) });
    views.set(world, view);
  }
  return view;
}
export function overWater(world, x, z) {
  const water = world.waterAt?.(x, z);
  return Boolean(water && water.level + ROADSTER.waterGap > world.surface(x, z));
}

// Throttle and brake. On the tyres: traction-limited at launch, then
// power-limited (P = m·a·v). Off the tarmac the tyres grip less, though the
// fans hold them down. Over water
// the rear nozzles push instead. Braking and reverse match the ATLAS.
export function roadsterAcceleration(throttle, forward, paved, dirt, power, water, suction = true) {
  if (throttle > 0) {
    if (forward < -.5) return throttle * 45;
    if (water) return throttle * ROADSTER.waterThrust;
    const grip = mix(suction ? SUCTION.grassGrip : .6, dirt ? .8 : 1, paved);
    return throttle * Math.min(ROADSTER.launch * grip, ROADSTER.power * power / Math.max(forward, 1));
  }
  if (throttle < 0) return -throttle * (forward > .5 ? -55 : -18 * (1 - smoothstep(10, 16, -forward)));
  return 0;
}
// The velocity's decay factor over one step. Braking, the rear wing tilts up
// into an air brake and triples the aero drag.
export const AIR_BRAKE = 3;
export function roadsterDrag(car, brake, paved, dt) {
  const v = Math.hypot(car.vx, car.vz);
  const surface = !car.grounded ? 0 : brake ? DRAG.brake : car.overWater ? DRAG.water : mix(DRAG.grass, car.onDirt ? DRAG.dirt : DRAG.road, paved);
  return Math.exp(-(surface + AERO * v * (car.airBrake ? AIR_BRAKE : 1)) * dt);
}

// One step of the thrusters: E (boost) fires the rear nozzles; F (lift) the
// corner nozzles, which climb at up to 8 m/s toward 5 m and hold there, and
// slow a fall from higher up. Each group empties the tank in 5.5 s; it
// refills while the car is on its wheels (or cushion) and neither is held.
// Returns the boost (m/s² forward) and lift (m/s² upward) for this step.
export function fireThrusters(car, input, dt) {
  const boost = !!input.boost && car.gas > 0, lift = !!input.lift && car.gas > 0;
  car.gas = clamp(car.gas - (Number(boost) + Number(lift)) * dt / ROADSTER.tank, 0, 1);
  // Held on an empty tank, nothing refills: no flicker of tiny hops.
  if (!input.boost && !input.lift && car.grounded) car.gas = Math.min(1, car.gas + dt / ROADSTER.refill);
  let up = 0;
  if (lift) {
    const height = car.y - car.groundY, target = clamp(1.8 * (ROADSTER.hoverHeight - height), -ROADSTER.climbRate, ROADSTER.climbRate);
    up = clamp(GRAVITY + 6 * (target - car.vy), 0, ROADSTER.lift);
  }
  car.boost = boost ? 1 : 0; car.lift = up / ROADSTER.lift;
  if (boost) car.boostTime += dt;
  if (lift) car.hoverTime += dt;
  return { boost: boost ? ROADSTER.boost : 0, lift: up, lifting: lift };
}
// The state the Roadster adds to a vehicle.
export function roadsterState(water) {
  return { wheelRadius: ROADSTER.wheelRadius, gas: 1, boost: 0, lift: 0, yaw: 0, overWater: water, fans: true, suction: !water, airBrake: false, hops: 0, boostTime: 0, hoverTime: 0, waterDistance: 0 };
}
