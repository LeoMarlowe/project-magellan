// Shared, deterministic world and vehicle simulation. No browser or renderer required.
import { createLakes, lakeRadius } from './lakes.mjs?v=rivers-1';
import { createRoads, ROAD_HALF, ROAD_REACH, ROAD_CELL } from './roads.mjs?v=rivers-1';
import { createRivers } from './rivers.mjs?v=rivers-1';
import { stepAmphibious } from './amphibious-motion.mjs?v=physics-16';
import { controlAxis } from './controls.mjs?v=slider-1';
import { stepFlight, wingStrikes } from './flight-motion.mjs?v=physics-16';
import { clamp, mix, smoothstep, hash, random, noise } from './noise.mjs?v=terrain-1';
import { createLandforms, TREELINE, SNOW_LINE } from './landforms.mjs?v=terrain-1';
export { clamp, mix, smoothstep, hash, random, noise };
export const CHUNK = 96;
export const GRID = 4;
export { ROAD_HALF };
export const FIXED_DT = 1 / 120;
export const FEATURE_SPACING = CHUNK * 3;
export const SPEED_LIMIT = 92; // Downhill cap; level-road cruising reaches ~300 km/h.
// Scenery models the world picks by place, in the nature library's order.
export const VARIANT = { tree: { snow: 2, stunted: 3, dead: 4 }, bush: { meadow: 0, desert: 1, juniper: 2 }, outcrop: { granite: 0, sandstone: 1, slab: 2 } };
export function createWorld(seed) {
  const land = createLandforms(seed);
  // The natural land, before roads and ramps shape it: lakes sit in it and
  // roads are routed over it (roads.mjs), so neither depends on the other.
  const natural = (x, z) => land.sample(x, z, 1).height;
  const lakes = createLakes(seed, natural, (x, z) => roadAt(x, z));
  const wet = (x, z) => { const lake = lakes.lakeAt(x, z); return Boolean(lake && lakeRadius(lake, x, z) < 1.1); };
  // Rivers feed the seas (rivers.mjs); roads cross them where they are narrow.
  const rivers = createRivers({ seed, ground: natural, wet, seasNear: lakes.seasNear, mountainAt: land.mountainAt });
  const riverCost = (x, z) => { const r = rivers.riverAt(x, z); return r && r.d < r.width / 2 + 12 ? 6 : 0; };
  const roads = createRoads({ seed, ground: natural, mountainAt: land.mountainAt, wet, riverCost, riverAt: rivers.riverAt });
  const roadAt = roads.roadAt;
  // The first road runs north from the start; the first ramps and the first
  // lookout stand beside it.
  const starterRoad = roads.edgesFrom(0, 0).find(e => e.id === '0,0>0,1');
  const besideStart = (s, side) => starterRoad ? roads.along(starterRoad, s, side) : { x: side, z: s, heading: 0 };
  // 0 away from the mountains, 1 in a range (see landforms.mjs).
  const mountainAt = land.mountainAt;
  const featureCache = new Map();
  const brokenProps = new Set(), breakEvents = [];
  function breakProp(prop, vx, vz) {
    if (brokenProps.has(prop.id)) return;
    brokenProps.add(prop.id); breakEvents.push({ ...prop, vx, vz });
  }
  const startJump = besideStart(68, -19), startTower = besideStart(145, 37), startRoll = besideStart(225, 24);
  const starterRamp = { id: 'first-jump', type: 'ramp', x: startJump.x, z: startJump.z, heading: startJump.heading, width: 10, length: 24, rise: 5.2, back: 10 };
  const starterTower = { id: 'first-lookout', type: 'lookout', x: startTower.x, z: startTower.z, heading: startTower.heading + .15 };
  const twistRamp = { id: 'first-roll', type: 'ramp', x: startRoll.x, z: startRoll.z, heading: startRoll.heading, width: 12, length: 30, rise: 8, back: 14, twist: -1 };
  function featureAtCell(cx, cz) {
    const key = `${cx},${cz}`;
    if (featureCache.has(key)) return featureCache.get(key);
    const rng = random((hash(cx, cz, seed + 303) * 4294967296) >>> 0);
    let x = (cx + .5) * FEATURE_SPACING + (rng() - .5) * 60, z = (cz + .5) * FEATURE_SPACING + (rng() - .5) * 60;
    // Sites stand beside a road when one passes within 150 m: 36 m off it, on
    // either side. Away from the roads only a few camps and lookouts remain.
    const road = roads.nearestRoad(x, z, 150), side = hash(cx, cz, seed + 306) < .5 ? -1 : 1, wild = !road && hash(cx, cz, seed + 307) > .25;
    if (road) { x = road.x + Math.cos(road.heading) * 36 * side; z = road.z - Math.sin(road.heading) * 36 * side; }
    // Never on another road, nor crowding the cell's neighbours.
    if (roadAt(x, z).d < 30) { x = road ? road.x + Math.cos(road.heading) * 60 * side : x; z = road ? road.z - Math.sin(road.heading) * 60 * side : z; }
    x = clamp(x, cx * FEATURE_SPACING + 40, (cx + 1) * FEATURE_SPACING - 40);
    z = clamp(z, cz * FEATURE_SPACING + 40, (cz + 1) * FEATURE_SPACING - 40);
    // Ramps, camps and lookouts need fairly level ground: none on a mountain
    // side, a mesa edge or a dune field's steep faces.
    let lo = Infinity, hi = -Infinity;
    for (const [dx, dz] of [[0, 0], [28, 0], [-28, 0], [0, 28], [0, -28]]) { const h = land.sample(x + dx, z + dz).height; lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const kind = rng(), type = hi - lo > 9 || wild || roadAt(x, z).d < 25 ? 'none' : !road ? (kind < .6 ? 'camp' : 'lookout') : kind < .58 ? 'ramp' : kind < .82 ? 'camp' : 'lookout';
    const heading = (road ? road.heading : rng() * Math.PI * 2) + (rng() - .5) * .6;
    const feature = { id: `site:${cx},${cz}`, type, x, z, heading, width: 9 + rng() * 3, length: 22 + rng() * 8, rise: 4.5 + rng() * 3, back: 12 };
    if (type === 'ramp' && hash(cx, cz, seed + 804) < .4) {
      feature.twist = hash(cx, cz, seed + 805) < .5 ? -1 : 1;
      feature.rise += 2; feature.width = 12;
    }
    // A bounded cache speeds up terrain sampling without changing revisits.
    if (featureCache.size >= 256) featureCache.delete(featureCache.keys().next().value);
    featureCache.set(key, feature);
    return feature;
  }
  function featuresNear(x, z, radius = 190) {
    const result = [starterRamp, starterTower, twistRamp];
    for (let cx = Math.floor((x - radius) / FEATURE_SPACING); cx <= Math.floor((x + radius) / FEATURE_SPACING); cx++) {
      for (let cz = Math.floor((z - radius) / FEATURE_SPACING); cz <= Math.floor((z + radius) / FEATURE_SPACING); cz++) result.push(featureAtCell(cx, cz));
    }
    return result.filter(f => f.type !== 'none' && Math.hypot(f.x - x, f.z - z) < radius && !waterAt(f.x, f.z));
  }
  function rampLift(ramp, x, z) {
    if (ramp.type !== 'ramp') return 0;
    const { across, along } = featureLocal(ramp, x, z);
    if (along < 0 || along > ramp.length + ramp.back || Math.abs(across) > ramp.width / 2 + 7) return 0;
    const profile = along <= ramp.length ? Math.pow(along / ramp.length, 1.7) : 1 - smoothstep(0, ramp.back, along - ramp.length);
    // Dirt embankments blend every side into the landscape. The orange deck
    // is rendered on these same triangles, so no invisible ramp collider exists.
    const bank = (ramp.twist || 0) * across * .72 * smoothstep(0, ramp.length, along);
    return Math.max(0, ramp.rise + bank) * profile * (1 - smoothstep(ramp.width / 2, ramp.width / 2 + 7, Math.abs(across)));
  }
  function rampAt(x, z) {
    if (waterAt(x, z)?.depth > .1) return null;
    for (const ramp of [starterRamp, twistRamp, featureAtCell(Math.floor(x / FEATURE_SPACING), Math.floor(z / FEATURE_SPACING))]) {
      if (ramp.type !== 'ramp') continue;
      const p = featureLocal(ramp, x, z);
      if (Math.abs(p.across) < ramp.width / 2 && p.along >= 0 && p.along <= ramp.length + 2) return ramp;
    }
    return null;
  }
  function reserved(x, z) {
    return featuresNear(x, z, 275).some(f => {
      const p = featureLocal(f, x, z);
      return f.type === 'ramp' ? Math.abs(p.across) < f.width / 2 + 9 && p.along > -30 && p.along < f.length + 220 : Math.hypot(p.across, p.along) < 18;
    });
  }
  function baseHeight(x, z, road = roadAt(x, z)) {
    // Plains, hills, mountain ranges, dunes and mesas (landforms.mjs); the
    // small rollers calm down under roads.
    let h = land.sample(x, z, smoothstep(9, 34, road.d)).height;
    // Roads are cut and filled to their own smooth profile: level across the
    // road and its shoulders, then a cutting or embankment back to the land,
    // wider the deeper it is. Where two roads run side by side (leaving the
    // same junction up one valley) the land meets both, so they share one
    // level where they overlap. Under a bridge the land is left to the river.
    if (road.d < ROAD_REACH && !road.bridge) {
      // How firmly each road holds the land here, and (more gently, so roads
      // drawing together ease toward one level) how much its level counts.
      const reach = (level, d) => 1 - smoothstep(8, 9 + clamp(Math.abs(level - h) * 1.5, 3, 45), d), weight = d => 1 - smoothstep(4, 20, d);
      const near = road.od < ROAD_REACH, other = near ? weight(road.od) : 0, own = weight(road.d);
      h += ((road.level * own + road.olevel * other) / (own + other || 1) - h) * Math.max(reach(road.level, road.d), near ? reach(road.olevel, road.od) : 0);
    }
    // Ramps rise out of the land.
    const feature = featureAtCell(Math.floor(x / FEATURE_SPACING), Math.floor(z / FEATURE_SPACING));
    return h + rampLift(feature, x, z) + rampLift(starterRamp, x, z) + rampLift(twistRamp, x, z);
  }
  function computeHeight(x, z) {
    // Rivers carve their channels and valleys, sparing the roads beside them
    // and a bridge's approach embankments (not its span), then lakes and seas
    // their basins. Last, a bridge's
    // approaches and abutments are built back up to the road, so the deck
    // meets the land at its own level; only the river's channel and banks
    // stay open beneath it.
    const road = roadAt(x, z);
    let h = baseHeight(x, z, road);
    const spared = road.bridge ? 0 : road.approach && road.d < 14 ? 1 : 1 - smoothstep(6, 14, road.d);
    if (spared < 1) h += (rivers.carve(x, z, h) - h) * (1 - spared);
    h = lakes.carve(x, z, h);
    if (road.approach && road.d < 16) {
      const river = rivers.riverAt(x, z), open = river ? smoothstep(river.width / 2 + 1, river.width / 2 + 7, river.d) : 1;
      h += (road.level - h) * (1 - smoothstep(8, 16, road.d)) * open;
    }
    return h;
  }
  function waterAt(x, z) {
    const lake = lakes.lakeAt(x, z);
    if (lake && lakeRadius(lake, x, z) <= 1.02) {
      const depth = lake.level - groundSurface(x, z);
      return depth > 0 ? { lake, level: lake.level, depth } : null;
    }
    // In a river's channel.
    const river = rivers.riverAt(x, z);
    if (!river || river.d > river.width / 2) return null;
    const depth = river.level - groundSurface(x, z);
    return depth > 0 ? { lake: { id: river.id, name: 'THE RIVER', level: river.level, river: true }, level: river.level, depth } : null;
  }
  // Chunk boundaries revisit most of the same terrain samples. Retain those
  // heights so a faster car doesn't rebuild the whole horizon every 96 m.
  // Eviction is bounded; cache contents never affect procedural generation.
  const heightCache = new Map();
  function height(x, z) {
    if (!Number.isInteger(x) || !Number.isInteger(z)) return computeHeight(x, z);
    const key = `${x},${z}`;
    if (heightCache.has(key)) return heightCache.get(key);
    const h = computeHeight(x, z);
    if (heightCache.size >= 120000) {
      const oldest = heightCache.keys();
      for (let i = 0; i < 16000; i++) heightCache.delete(oldest.next().value);
    }
    heightCache.set(key, h); return h;
  }
  // Exactly the same triangles as the rendered 4 m terrain grid. This avoids
  // invisible bumps, wheel clipping, or a mismatch between visuals and physics.
  function groundSurface(x, z) {
    const ix = Math.floor(x / GRID) * GRID, iz = Math.floor(z / GRID) * GRID;
    const u = (x - ix) / GRID, v = (z - iz) / GRID;
    const a = height(ix, iz), b = height(ix + GRID, iz), c = height(ix, iz + GRID), d = height(ix + GRID, iz + GRID);
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  // What a car drives on: the ground, or a bridge deck over a river (unless
  // whatever asks is well below the deck, like a boat passing beneath; y is
  // its height, if known).
  function surface(x, z, y = Infinity) {
    const ground = groundSurface(x, z), road = roadAt(x, z);
    return road.bridge && road.d < ROAD_HALF + .9 && y > road.level - 1.5 ? Math.max(ground, road.level) : ground;
  }
  function gradient(x, z) { return { x: (surface(x + 2, z) - surface(x - 2, z)) / 4, z: (surface(x, z + 2) - surface(x, z - 2)) / 4 }; }
  // How far a point sits below the ground around it, in metres: positive in
  // hollows and valleys, negative on rises and ridges.
  function hollow(x, z, r = 24) { return (height(x + r, z) + height(x - r, z) + height(x, z + r) + height(x, z - r)) / 4 - height(x, z); }
  // 0–1: the foot of a slope, where a gentler slope gathers beneath steeper
  // ground and loose rock collects.
  function footOfSlope(x, z, slope = Math.hypot(gradient(x, z).x, gradient(x, z).z)) {
    return smoothstep(.6, 3, hollow(x, z)) * smoothstep(.12, .3, slope) * (1 - smoothstep(.55, .8, slope));
  }
  function woodlandAt(x, z) { return noise(x * .0031 - 13, z * .0031 + 27, seed + 87); }
  // Broad, continuous dry regions, never in the mountains; elevation keeps
  // sand off high ground.
  function desertAt(x, z, elevation = height(x, z)) {
    return land.desertMask(x, z) * (1 - mountainAt(x, z)) * (1 - smoothstep(150, 200, elevation));
  }
  function props(cx, cz) {
    const rng = random((hash(cx, cz, seed + 101) * 4294967296) >>> 0), list = [];
    // Fixed candidates and clearances make revisited chunks identical.
    for (let i = 0; i < 30; i++) {
      const x = cx * CHUNK + 9 + rng() * (CHUNK - 18), z = cz * CHUNK + 9 + rng() * (CHUNK - 18);
      const chance = rng(), size = .8 + rng() * .65, turn = rng() * Math.PI * 2;
      const woodland = woodlandAt(x, z), mountain = mountainAt(x, z), desert = desertAt(x, z);
      if (Math.hypot(x, z) < 24 || roadAt(x, z).d < 12 || waterAt(x, z) || reserved(x, z)) continue;
      const g = gradient(x, z), slope = Math.hypot(g.x, g.z), y = surface(x, z), id = `${cx},${cz}:${i}`;
      // A second, independent roll for which tree or bush grows here.
      const pick = hash(Math.round(x * 4), Math.round(z * 4), seed + 111);
      // Outcrops: crags on steep mountain ground, sandstone ledges on mesa
      // walls and desert slopes, slabs on steep hillsides. Big, so spaced out.
      if (slope > .45 && chance < .16 && (mountain > .3 || desert > .3 || slope > .7)) {
        if (!list.some(p => Math.hypot(p.x - x, p.z - z) < 20)) {
          const variant = mountain > .3 ? VARIANT.outcrop.granite : desert > .3 ? VARIANT.outcrop.sandstone : VARIANT.outcrop.slab;
          list.push({ id, type: 'outcrop', variant, x, z, y, size, turn, r: 2.1 * size, h: (variant === VARIANT.outcrop.slab ? 2.2 : 5.5) * size });
        }
        continue;
      }
      if (slope > .9) continue;
      if (list.some(p => Math.hypot(p.x - x, p.z - z) < (p.type === 'outcrop' ? 12 : 7.5))) continue;
      // Boulders, rocks and scree gather at the foot of slopes, in the ranges
      // and beneath the mesas.
      if ((mountain > .15 || desert > .3) && chance < .45 && footOfSlope(x, z, slope) > .35) {
        if (chance < .16) list.push({ id, type: 'boulder', x, z, y, size: size * 2.3, turn, r: size * 1.5, h: size * 2.6 });
        else if (mountain > .15 && chance < .32) list.push({ id, type: 'scree', x, z, y, size, turn, r: 0, h: .4 });
        else list.push({ id, type: 'rock', x, z, y, size, turn, r: 0, h: .65 * size });
        continue;
      }
      // Loose stone on the high, moderately steep mountain slopes.
      if (mountain > .25 && slope > .3 && y > TREELINE - 50 && chance > .8) { list.push({ id, type: 'scree', x, z, y, size, turn, r: 0, h: .4 }); continue; }
      // Above the treeline: rocks and boulders, and low junipers below the snow.
      const alpine = smoothstep(TREELINE - 30, TREELINE + 10, y);
      if (alpine > .5) {
        if (chance < (y > SNOW_LINE ? .12 : .3)) list.push({ id, type: chance < .1 ? 'boulder' : 'rock', x, z, y, size: chance < .1 ? size * 2.3 : size, turn, r: chance < .1 ? size * 1.5 : 0, h: chance < .1 ? size * 2.6 : .65 * size });
        else if (y < SNOW_LINE - 10 && chance < .5) list.push({ id, type: 'bush', variant: VARIANT.bush.juniper, x, z, y, size, turn, r: 0, h: .6 * size });
        continue;
      }
      if (chance < .1 && mountain > .25) list.push({ id, type: 'boulder', x, z, y, size: size * 2.3, turn, r: size * 1.5, h: size * 2.6 });
      else if (chance < .22) list.push({ id, type: 'rock', x, z, y, size, turn, r: 0, h: .65 * size });
      else if (desert > .55) {
        if (chance < .62) list.push({ id, type: 'cactus', x, z, y, size, turn, r: .38 * size, h: 4.7 * size });
        else if (chance < .76) list.push({ id, type: 'bush', variant: VARIANT.bush.desert, x, z, y, size, turn, r: 0, h: .9 * size });
        else list.push({ id, type: 'rock', x, z, y, size: size * .7, turn, r: 0, h: .5 * size });
      }
      else if (chance < mix(.46, .95, smoothstep(.3, .75, woodland)) * (1 - alpine * 1.6) && mountain < .95) {
        // Snow-dusted pines on the cold upper slopes, wind-stunted ones at the
        // treeline, and dead snags where the land dries out.
        const upper = smoothstep(TREELINE - 80, TREELINE - 40, y);
        const variant = y > TREELINE - 35 ? VARIANT.tree.stunted : pick < upper * .6 ? VARIANT.tree.snow
          : (desert > .12 && pick < .35) || pick < .015 ? VARIANT.tree.dead : undefined;
        const height = variant === VARIANT.tree.stunted ? 3.4 : variant === VARIANT.tree.dead ? 5.8 : 6.8;
        list.push({ id, type: 'tree', variant, x, z, y, size, turn, r: .24 * size, h: height * size });
      } else list.push({ id, type: 'bush', variant: desert > .3 ? VARIANT.bush.desert : y > TREELINE - 60 ? VARIANT.bush.juniper : undefined, x, z, y, size, turn, r: 0, h: size });
    }
    for (const f of featuresNear(cx * CHUNK + CHUNK / 2, cz * CHUNK + CHUNK / 2, 100)) {
      if (Math.floor(f.x / CHUNK) !== cx || Math.floor(f.z / CHUNK) !== cz || f.type === 'ramp') continue;
      list.push({ ...f, y: surface(f.x, f.z), size: 1, turn: f.heading, r: f.type === 'camp' ? 3.6 : 2.1, h: f.type === 'camp' ? 5 : 11 });
    }
    return list.filter(p => !brokenProps.has(p.id));
  }
  return { seed, height, surface, groundSurface, gradient, hollow, footOfSlope, mountainAt, woodlandAt, desertAt, roadAt, roadsNear: roads.roadsNear, prepareRoads: (x, z, r, ms) => rivers.prepare(x, z, r + 3 * ROAD_CELL, ms / 2) && roads.prepare(x, z, r, ms / 2), riversNear: rivers.riversNear, riverAt: rivers.riverAt, roadMap: roads.roadMap, alongRoad: roads.along, startHeading: starterRoad ? roads.along(starterRoad, 0).heading : 0, props, featuresNear, rampLift, rampAt, reserved, starterRamp, twistRamp, waterAt, lakeAt: lakes.lakeAt, lakesNear: lakes.near, seasNear: lakes.seasNear, starterLake: lakes.starter, starterSea: lakes.starterSea, brokenProps, breakProp, drainBreakEvents: () => breakEvents.splice(0) };
}

export function featureLocal(feature, x, z) {
  const dx = x - feature.x, dz = z - feature.z, s = Math.sin(feature.heading), c = Math.cos(feature.heading);
  return { across: dx * c - dz * s, along: dx * s + dz * c };
}
export function featurePoint(feature, across, along) {
  const s = Math.sin(feature.heading), c = Math.cos(feature.heading);
  return { x: feature.x + across * c + along * s, z: feature.z - across * s + along * c };
}

// y: the car's height, so a boat beneath a bridge isn't lifted onto its deck.
export function groundAt(world, x, z, heading, y) {
  const fx = Math.sin(heading), fz = Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading);
  const f = world.surface(x + fx * 1.36, z + fz * 1.36, y), b = world.surface(x - fx * 1.36, z - fz * 1.36, y);
  const l = world.surface(x + rx * .96, z + rz * .96, y), r = world.surface(x - rx * .96, z - rz * .96, y);
  return { y: Math.max(world.surface(x, z, y), (f + b + l + r) / 4) + .06, pitch: -Math.atan((f - b) / 2.72), roll: Math.atan((l - r) / 1.92) };
}
export function createVehicle(world, x = 0, z = 0, heading = 0) {
  const g = groundAt(world, x, z, heading);
  const water = world.waterAt?.(x, z), floating = Boolean(water && water.depth > .9);
  return { x, z, y: floating ? Math.max(g.y, water.level - .52) : g.y, vx: 0, vz: 0, vy: 0, heading, steer: 0, grounded: !floating, groundY: g.y, pitch: floating ? 0 : g.pitch, roll: floating ? 0 : g.roll, rollVelocity: 0, airRoll: 0, rolls: 0, smashed: 0, distance: 0, airtime: 0, bestAir: 0, airDistance: 0, bestJump: 0, landings: 0, jumps: 0, jumpBuffer: 0, coyote: .1, jumpHeld: false, landLock: 0, impact: 0, speed: 0, onRoad: !floating, time: 0, transform: floating ? 1 : 0, boatMode: floating, floating, waterDepth: water?.depth ?? 0, waterLevel: water?.level ?? null, boatDistance: 0, transformations: 0, flightMode: false, flight: 0, flying: false, airspeed: 0, climb: 0, sink: 0, flights: 0, flightDistance: 0, maxAltitude: 0, climbOut: false, crashFold: false, alpha: 0, shadow: 0, shadowVy: 0, qx: 0, qy: Math.sin(heading / 2), qz: 0, qw: Math.cos(heading / 2) };
}
export function resolveObstacles(car, obstacles, world) {
  for (let pass = 0; pass < 3; pass++) for (const o of obstacles) {
    // Small rocks are forgiving ground detail. Trees collide only with their
    // trunks; airborne cars can clear props, and canopies never form walls.
    if (world?.brokenProps?.has(o.id) || car.y + .2 > o.y + o.h || car.y + 2.3 < o.y) continue;
    const breakable = ['tree', 'cactus', 'rock', 'boulder'].includes(o.type);
    const obstacleRadius = o.r || (o.type === 'rock' ? .55 * o.size : 0);
    if (!obstacleRadius) continue;
    const dx = car.x - o.x, dz = car.z - o.z, radius = obstacleRadius + .93;
    const d = Math.hypot(dx, dz);
    if (d >= radius) continue;
    const nx = d > 1e-6 ? dx / d : -Math.sin(car.heading), nz = d > 1e-6 ? dz / d : -Math.cos(car.heading);
    const impactSpeed = -(car.vx * nx + car.vz * nz);
    if (breakable && world?.breakProp && impactSpeed >= (o.type === 'boulder' ? 26 : 18)) {
      world.breakProp(o, car.vx, car.vz); car.smashed++;
      car.vx *= .88; car.vz *= .88; car.impact = Math.max(car.impact, .2);
      continue;
    }
    if (!o.r) continue; // Small stones remain forgiving at low speed.
    car.x += nx * (radius - d + .002); car.z += nz * (radius - d + .002);
    const approach = car.vx * nx + car.vz * nz;
    if (approach < 0) { car.vx -= nx * approach * 1.08; car.vz -= nz * approach * 1.08; car.impact = Math.max(car.impact, -approach * .012); }
  }
}
function launchRoll(car, ramp, speed) {
  if (!ramp?.twist || speed < 12) return;
  // One turn over the estimated ballistic flight, with gentle landing recovery.
  car.rollVelocity = ramp.twist * Math.PI * 2 / clamp(2 * car.vy / 22, .85, 2.5);
  car.airRoll = 0;
}
export function stepVehicle(car, input, world, obstacles, dt = FIXED_DT) {
  if (stepFlight(car, input, world, dt, groundAt) || stepAmphibious(car, input, world, dt, groundAt)) {
    // Space climbs in the air and does nothing afloat: never let a press made
    // there (or one held through the landing) fire a jump on touchdown.
    car.jumpBuffer = 0; car.jumpHeld = !!input.jump;
    if (car.flight > .3) wingStrikes(car, obstacles, world);
    resolveObstacles(car, obstacles, world); return;
  }
  const throttle = controlAxis(input.throttle, input.up, input.down), brake = !!input.brake;
  const jumpPressed = !!input.jump && !car.jumpHeld;
  car.jumpHeld = !!input.jump;
  car.jumpBuffer = jumpPressed ? .16 : Math.max(0, car.jumpBuffer - dt);
  car.landLock = Math.max(0, car.landLock - dt);
  car.coyote = car.grounded ? .1 : Math.max(0, car.coyote - dt);
  if (car.jumpBuffer > 0 && car.coyote > 0) {
    car.vy = 10 + clamp(car.vy, 0, 2); car.grounded = false; car.coyote = 0; car.shadow = 0; car.shadowVy = 0;
    car.jumpBuffer = 0; car.landLock = .16; car.airtime = 0; car.airDistance = 0; car.airRoll = 0; car.jumps++;
    const launchRamp = world.rampAt?.(car.x, car.z);
    if (launchRamp && featureLocal(launchRamp, car.x, car.z).along > launchRamp.length * .4) launchRoll(car, launchRamp, car.vx * Math.sin(launchRamp.heading) + car.vz * Math.cos(launchRamp.heading));
  }
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const forward = car.vx * fx + car.vz * fz, speed = Math.abs(forward);
  const roadDistance = world.roadAt(car.x, car.z).d;
  car.onRoad = roadDistance < ROAD_HALF;
  const highway = 1 - smoothstep(ROAD_HALF - 1, ROAD_HALF + 3, roadDistance);
  const authority = car.grounded ? 1 : .16;
  // Slopes: climbing lowers the top speed (the engine runs out of power), and
  // on faces steeper than about 40° the tyres lose their grip altogether, so
  // the car slides back rather than racing up a mountainside.
  const slope = car.grounded ? world.gradient(car.x, car.z) : { x: 0, z: 0 }, rise = slope.x * fx + slope.z * fz;
  const climbing = car.grounded ? smoothstep(.15, .7, rise * Math.sign(forward || throttle || 1)) : 0;
  const power = 1 - .6 * climbing;
  let acceleration = 0;
  if (throttle > 0) acceleration = throttle * (forward < -.5 ? 45 : 34 * (1 - smoothstep(mix(56, 72, highway) * power, mix(72, 89.5, highway) * power, forward)));
  if (throttle < 0) acceleration = -throttle * (forward > .5 ? -55 : -18 * (1 - smoothstep(10, 16, -forward)));
  const uphillPush = rise * Math.sign(acceleration);
  if (car.grounded && uphillPush > 0) acceleration *= 1 - .9 * smoothstep(.5, .95, uphillPush);
  car.vx += fx * acceleration * authority * dt; car.vz += fz * acceleration * authority * dt;
  const targetSteer = controlAxis(input.steer, input.left, input.right);
  car.steer = mix(car.steer, targetSteer, 1 - Math.exp(-10 * dt));
  car.heading += car.steer * (brake ? 2.1 : 1.7) * Math.min(speed / 5, 1) / (1 + speed * .032) * Math.sign(forward || 1) * authority * dt;
  const nx = Math.sin(car.heading), nz = Math.cos(car.heading), along = car.vx * nx + car.vz * nz;
  const grip = car.grounded ? (brake ? 1.9 : car.onRoad ? 12 : 8) : .2;
  const decay = Math.exp(-grip * dt);
  car.vx = nx * along + (car.vx - nx * along) * decay; car.vz = nz * along + (car.vz - nz * along) * decay;
  const drag = Math.exp(-(car.grounded ? brake ? 1.6 : car.onRoad ? .11 : .19 : .015) * dt);
  car.vx *= drag; car.vz *= drag;
  if (car.grounded) {
    const g = slope, steep = 8 + 10 * smoothstep(.4, 1, Math.hypot(g.x, g.z));
    // Hill hold at rest; on gentle ground the engine comfortably exceeds
    // downhill gravity, and steep faces pull harder.
    if (throttle || speed > .5) { car.vx -= g.x * steep * dt; car.vz -= g.z * steep * dt; }
    if (!throttle && Math.hypot(car.vx, car.vz) < .35) { car.vx = 0; car.vz = 0; }
  }
  const horizontal = Math.hypot(car.vx, car.vz);
  if (horizontal > SPEED_LIMIT) { car.vx *= SPEED_LIMIT / horizontal; car.vz *= SPEED_LIMIT / horizontal; }
  const oldX = car.x, oldZ = car.z;
  car.x += car.vx * dt; car.z += car.vz * dt;
  if (!car.grounded) { car.vy -= 22 * dt; car.y += car.vy * dt; car.airtime += dt; car.airDistance += Math.hypot(car.vx, car.vz) * dt; car.bestAir = Math.max(car.bestAir, car.airtime); }
  resolveObstacles(car, obstacles, world);
  const g = groundAt(world, car.x, car.z, car.heading, car.y);
  const ramp = world.rampAt?.(car.x, car.z);
  const rampPosition = ramp && featureLocal(ramp, car.x, car.z);
  const surfaceVy = clamp((g.y - car.groundY) / dt, -32, 32);
  if (car.grounded) {
    const rampSpeed = ramp ? car.vx * Math.sin(ramp.heading) + car.vz * Math.cos(ramp.heading) : 0;
    if (ramp && rampSpeed > 8 && rampPosition.along >= ramp.length - 1.5 && featureLocal(ramp, oldX, oldZ).along < ramp.length - 1.5) {
      car.grounded = false; car.airtime = 0; car.airDistance = 0; car.airRoll = 0; car.coyote = 0; car.landLock = .06; car.shadow = 0; car.shadowVy = 0;
      car.vy = clamp(Math.max(car.vy, rampSpeed * ramp.rise * 1.7 / ramp.length), 6, 28); car.y = Math.max(car.y, g.y) + .03;
      launchRoll(car, ramp, rampSpeed);
    }
    // Every surface can fall away beneath the car, including ramp backs and
    // sides. Being inside a ramp must never suppress ballistic separation.
    // The ground can push the car up but never pull it down: from the moment
    // the surface drops away faster than gravity, a ballistic "shadow" follows
    // the car's own momentum. Once that path clears the surface by a couple of
    // centimetres the car leaves with its full climbing speed, so a rounded
    // crest launches just like a sharp one, while small bumps never add up.
    // (Just after a touchdown it takes a little more, so landings don't bounce.)
    else {
      const ballistic = (car.shadow ? car.shadowVy : car.vy) - 22 * dt;
      if (horizontal > 9 && surfaceVy < ballistic) {
        if (!car.shadow) car.shadow = 0;
        car.shadowVy = ballistic; car.shadow += (ballistic - surfaceVy) * dt;
      } else car.shadow = 0;
      if (car.shadow > (car.landLock ? .05 : .025)) {
        car.grounded = false; car.airtime = 0; car.airDistance = 0; car.airRoll = 0;
        car.vy = clamp(car.shadowVy, -3, 28); car.y = g.y + car.shadow; car.shadow = 0; car.shadowVy = 0;
        launchRoll(car, ramp, Math.abs(rampSpeed));
      } else { car.y = g.y; car.vy = surfaceVy; }
    }
  } else if (car.y <= g.y && (!car.landLock || car.vy < 0)) {
    car.impact = Math.max(car.impact, clamp(-car.vy * .016, 0, .3));
    car.bestJump = Math.max(car.bestJump, car.airDistance); car.landings++;
    // A ballistic gap from before the jump must not relaunch the car.
    car.y = g.y; car.vy = surfaceVy; car.grounded = true; car.landLock = .1; car.shadow = 0; car.shadowVy = 0;
    car.rollVelocity = 0;
    car.roll = Math.atan2(Math.sin(car.roll), Math.cos(car.roll));
  }
  // Rising terrain always supports the car, even during a jump's launch lock.
  car.y = Math.max(car.y, g.y);
  car.groundY = g.y;
  // In the air the car keeps the tilt it left the ground with (nothing pushes
  // it level), drifting only slowly: the nose toward the flight path and the
  // body toward upright. On the ground it settles onto the surface quickly.
  car.pitch = mix(car.pitch, car.grounded ? g.pitch : clamp(-car.vy * .025, -.28, .24), 1 - Math.exp(-(car.grounded ? 14 : .7) * dt));
  if (!car.grounded && car.rollVelocity) {
    const before = Math.floor(car.airRoll / (Math.PI * 2));
    car.roll += car.rollVelocity * dt; car.airRoll += Math.abs(car.rollVelocity) * dt;
    car.rolls += Math.floor(car.airRoll / (Math.PI * 2)) - before;
  } else car.roll = mix(car.roll, car.grounded ? g.roll : 0, 1 - Math.exp(-(car.grounded ? 12 : .5) * dt));
  car.impact *= Math.exp(-8 * dt);
  car.speed = car.vx * nx + car.vz * nz;
  car.distance += Math.hypot(car.x - oldX, car.z - oldZ);
}
export function recoverVehicle(car, world) {
  const road = world.roadAt(car.x, car.z);
  const origin = road.d < 55 || world.waterAt?.(car.x, car.z) ? road : car;
  // A recovery search repeatedly visits the same few chunk neighborhoods.
  // Scope the cache to this attempt so callers never see stale/mutable props.
  const propCache = new Map();
  const cachedProps = (cx, cz) => {
    const key = `${cx},${cz}`;
    if (!propCache.has(key)) propCache.set(key, world.props(cx, cz));
    return propCache.get(key);
  };
  for (let ring = 0; ring < 14; ring++) for (let i = 0; i < (ring ? 12 : 1); i++) {
    const x = origin.x + Math.cos(i * Math.PI / 6) * ring * 3, z = origin.z + Math.sin(i * Math.PI / 6) * ring * 3;
    if (world.waterAt?.(x, z)) continue;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const nearby = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) nearby.push(...cachedProps(cx + dx, cz + dz));
    if (nearby.some(o => o.r && Math.hypot(x - o.x, z - o.z) < o.r + 3)) continue;
    const slope = world.gradient(x, z);
    if (Math.hypot(slope.x, slope.z) > .6) continue;
    const { distance, bestAir, jumps, bestJump, landings, rolls, smashed, boatDistance, transformations, flights, flightDistance, maxAltitude } = car;
    Object.assign(car, createVehicle(world, x, z, car.heading), { distance, bestAir, jumps, bestJump, landings, rolls, smashed, boatDistance, transformations, flights, flightDistance, maxAltitude });
    return true;
  }
  return false;
}
