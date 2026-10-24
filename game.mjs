import { createTerrain } from './terrain.mjs?v=classes-3';
import { createWater } from './water.mjs?v=rivers-1';
import { FAR_SIZE, FAR_VIEW, NEAR_VIEW, ULTRA_SIZE, ULTRA_VIEW, ULTRA_BLEND_START, ULTRA_BLEND_END, farIndices, farCoverage, ultraIndices, ultraCoverage } from './streaming-layout.mjs?v=classes-3';
import { loadVehicleModel } from './vehicle-model.mjs?v=flight-1';
import { createProfiler } from './profiling.mjs?v=timing-1';
import { createDebris } from './debris.mjs?v=perf-1';
import { createDust } from './dust.mjs?v=classes-2';
import { createVehiclePresentation } from './vehicle-presentation.mjs?v=physics-16';
import { followTarget, followValue } from './camera-motion.mjs?v=grass-1';
import { createTreeBreakage } from './tree-breakage.mjs?v=nature-1';
import { loadNatureLibrary } from './nature-models.mjs?v=nature-2';
import { createBreakAudio } from './break-audio.mjs?v=sound-2';
import { createVehicleAudio } from './vehicle-audio.mjs?v=weather-2';
import { installSunShadowFade } from './shadow-fade.mjs?v=shadow-1';
import { createGrass } from './grass.mjs?v=grass-8';
import { createPerfMeter, createGpuTimer } from './perf-meter.mjs?v=perf-2';
import { QUALITY_PRESETS, qualityLevels, presetLevel, autoStartLevel, createAutoQuality } from './quality.mjs?v=perf-1';
import { controlAxis, steerAxis } from './controls.mjs?v=slider-1';
import { readTilt, tiltAxes } from './tilt.mjs?v=tilt-1';
import { toggleFlight, flightAxes, TAKEOFF_SPEED, STALL_SPEED } from './flight-motion.mjs?v=physics-17';
import { createClouds } from './clouds.mjs?v=clouds-3';
import { weatherAt } from './weather.mjs?v=terrain-1';
import { createSky } from './sky.mjs?v=clouds-8';
import { daylight, advanceClock, clockLabel, startHour } from './daylight.mjs?v=day-3';
import { createWeatherEffects, toneMappedHorizon } from './weather-effects.mjs?v=day-1';
import * as THREE from 'three';
import { CHUNK, GRID, ROAD_HALF, FIXED_DT, featurePoint, clamp, mix, smoothstep, hash, createWorld, createVehicle, stepVehicle, recoverVehicle, groundAt } from './world.mjs?v=classes-2';
import { SNOW_LINE } from './landforms.mjs?v=classes-2';
import { ROAD_MAP } from './roads.mjs?v=classes-2';
import { buildLandmark, cloneOwnedGeometry, buildLandmarkStandins, landmarkSwapDistance } from './scenery.mjs?v=standin-5';
import { createMotionBlur } from './motion-blur.mjs?v=blur-1';

const $ = id => document.getElementById(id);
const coarse = matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0;
// A phone (not a tablet) is held sideways to play: its short side is under 600 px.
const phone = coarse && Math.min(screen.width, screen.height) < 600;
const landscape = matchMedia('(orientation: landscape)');
const upright = () => phone && !landscape.matches;
const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const testMode = ['drive', 'ramp', 'twist', 'smash', 'tree-smash', 'browser', 'water', 'boat', 'fly', 'sea'].includes(new URLSearchParams(location.search).get('test'));
const profiler = createProfiler(testMode);
const bootStarted = performance.now();
if (coarse) document.body.classList.add('touch');
const seedFromUrl = Number(new URLSearchParams(location.search).get('seed'));
const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000;
let seed = Number.isSafeInteger(seedFromUrl) && seedFromUrl > 0 ? seedFromUrl % 2147483647 || 1 : freshSeed();
let world = createWorld(seed), vehicle = createVehicle(world, 0, 0, world.startHeading);
if (['water', 'boat'].includes(new URLSearchParams(location.search).get('test'))) {
  const lake = world.starterLake, afloat = new URLSearchParams(location.search).get('test') === 'boat';
  vehicle = createVehicle(world, lake.x, afloat ? lake.z : lake.z - lake.rz * 1.12, 0);
}
// Reproducible launch position used by the browser integration harness.
if (new URLSearchParams(location.search).get('test') === 'ramp') {
  const p = featurePoint(world.starterRamp, 0, -35);
  vehicle = createVehicle(world, p.x, p.z, world.starterRamp.heading);
}
if (new URLSearchParams(location.search).get('test') === 'twist') {
  const p = featurePoint(world.twistRamp, 0, -35);
  vehicle = createVehicle(world, p.x, p.z, world.twistRamp.heading);
}
if (new URLSearchParams(location.search).get('test') === 'smash') {
  const prop = world.props(0, 0).find(p => ['cactus', 'tree', 'boulder'].includes(p.type));
  if (prop) vehicle = createVehicle(world, prop.x, prop.z - 32, 0);
}
// Preview flight directly: already airborne above the spawn road.
if (new URLSearchParams(location.search).get('test') === 'fly') {
  Object.assign(vehicle, { flightMode: true, flight: 1, flying: true, airspeed: 50, climb: 0, grounded: false, vz: 50, speed: 50 });
  vehicle.y += 120;
}
// Preview the starter inland sea from the air, approaching its coast.
if (new URLSearchParams(location.search).get('test') === 'sea') {
  const sea = world.starterSea, heading = Math.atan2(sea.x, sea.z), back = Math.max(sea.rx, sea.rz) * 1.3 + 500;
  vehicle = createVehicle(world, sea.x - Math.sin(heading) * back, sea.z - Math.cos(heading) * back, heading);
  Object.assign(vehicle, { flightMode: true, flight: 1, flying: true, airspeed: 50, climb: 0, grounded: false, vx: Math.sin(heading) * 50, vz: Math.cos(heading) * 50, speed: 50 });
  vehicle.y += 140;
}
if (new URLSearchParams(location.search).get('test') === 'tree-smash') {
  const prop = world.props(-1, -1).find(p => p.type === 'tree');
  if (prop) vehicle = createVehicle(world, prop.x, prop.z - 32, 0);
}
let running = false, started = false, cameraMode = 0, muted = true, lightsOn = false, lightsChosen = false, bestDistance = 0;
if (!testMode) try { muted = localStorage.getItem('endless-drive-muted') !== '0'; bestDistance = Number(JSON.parse(localStorage.getItem('endless-drive-records') || '{}').distance) || 0; } catch {}
const input = {}, keyStates = new Set(), touchStates = new Map();
// Graphics and touch preferences. Tests use fixed, device-appropriate settings
// unless ?quality= is given, so slow software rendering never changes a level.
const settings = { quality: 'auto', sensitivity: 1, autoLevel: null };
if (!testMode) try { Object.assign(settings, JSON.parse(localStorage.getItem('endless-drive-settings') || '{}')); } catch {}
const qualityParam = new URLSearchParams(location.search).get('quality');
if (QUALITY_PRESETS.includes(qualityParam)) settings.quality = qualityParam;
else if (testMode) settings.quality = coarse ? 'medium' : 'high';
if (!QUALITY_PRESETS.includes(settings.quality)) settings.quality = 'auto';
settings.sensitivity = clamp(Number(settings.sensitivity) || 1, .5, 1.5);
settings.tilt = coarse && settings.tilt === true;
// Motion blur: on by default, off in tests unless ?blur=1. Phones used to
// default to off, and every save stored that, so a phone's saved "off" counts
// only once the player has chosen it.
const blurParam = new URLSearchParams(location.search).get('blur');
if (blurParam !== null) settings.motionBlur = blurParam === '1';
else if (testMode) settings.motionBlur = false;
else if (typeof settings.motionBlur !== 'boolean' || (coarse && !settings.motionBlurChosen)) settings.motionBlur = true;
// Flight always starts on the full controls; T switches for this visit only
// (an older build remembered simple controls).
delete settings.simpleFlight;
let simpleFlight = false;
// Settings → FPS meter: a frame-rate and frame-time overlay for debugging.
const perfMeter = createPerfMeter(document.body);
perfMeter.setVisible(Boolean(settings.perfMeter));
const saveSettings = () => { if (!testMode) try { localStorage.setItem('endless-drive-settings', JSON.stringify(settings)); } catch {} };
const levels = qualityLevels(coarse);
let auto = null, qualityLevel = 0;
function startQuality() {
  const saved = Number.isInteger(settings.autoLevel) && settings.autoLevel >= 0 && settings.autoLevel < levels.length ? settings.autoLevel : null;
  auto = settings.quality === 'auto' ? createAutoQuality({ start: saved ?? autoStartLevel(coarse), max: levels.length - 1 }) : null;
  return auto ? auto.level : presetLevel(settings.quality);
}
qualityLevel = startQuality();
const keyMap = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'jump', ShiftLeft: 'brake', ShiftRight: 'brake', KeyQ: 'yawLeft', KeyE: 'yawRight' };
// In the air the same keys fly on three axes. W/S throttle; ↑/↓ pitch like a
// flight stick (↓ pulls the nose up), with Space/Shift as climb/dive; A/D or
// ←/→ roll; Q/E yaw. Touch: ↑↓ throttle, the flight ring pitches and rolls.
const flightKeys = {
  throttleUp: ['KeyW'], throttleDown: ['KeyS'], pitchUp: ['Space', 'ArrowDown'], pitchDown: ['ShiftLeft', 'ShiftRight', 'ArrowUp'],
  rollLeft: ['KeyA', 'ArrowLeft'], rollRight: ['KeyD', 'ArrowRight'], yawLeft: ['KeyQ'], yawRight: ['KeyE'],
};
const flightTouch = { throttleUp: 'up', throttleDown: 'down', pitchUp: 'jump', pitchDown: 'brake', rollLeft: 'left', rollRight: 'right' };

installSunShadowFade();
// On computers the scene is multisampled in the motion blur's target (see
// motion-blur.mjs), so the screen needn't be; phones draw straight to it.
const renderer = new THREE.WebGLRenderer({ antialias: coarse, powerPreference: 'high-performance' });
const screenMultisampled = renderer.getContext().getContextAttributes().antialias;
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, levels[qualityLevel].pixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', 'Driving world. WASD to drive, Space to jump, Shift to drift, R to recover, Escape to pause.');
$('game').append(renderer.domElement);
// The FPS meter's GPU time, where the browser can measure it.
const gpuTimer = createGpuTimer(renderer.getContext());
const scene = new THREE.Scene();
// Water fades with the same (altitude-dependent) fog distances as terrain.
const fogUniforms = { uFogNear: { value: 350 }, uFogFar: { value: 1450 } }, streamCenterUniform = { value: new THREE.Vector2() };
// The water reflects the same sky and sun the scene is lit by (see the sky
// dome and sun below; the sun keeps a fixed offset from the car).
const waterSystem = createWater(scene, fogUniforms, streamCenterUniform, { sunDirection: new THREE.Vector3(-65, 100, 45), sunColor: '#fff0d2', skyTop: '#729eaf', skyBottom: '#b9cdd0' });
waterSystem.setDetail(qualityLevel > 0);
const skyColor = new THREE.Color('#b9cdd0');
scene.background = skyColor;
// Fog is applied after tone mapping, the sky before it. This is the sky's
// horizon colour after ACES at the current exposure, so fully fogged terrain
// disappears into the sky instead of leaving a darker band on the skyline.
const FOG_COLOR = new THREE.Color('#c8d1d3');
scene.fog = new THREE.Fog(FOG_COLOR, 350, 1450);
const camera = new THREE.PerspectiveCamera(57, innerWidth / innerHeight, .1, 6400);
const motionBlur = createMotionBlur(renderer);
// The blur's target is drawn exactly as the screen is, except that three.js
// hands over the fog and the clear (sky) colour in linear terms there: give
// them their on-screen values in it too.
for (const color of [scene.fog.color, skyColor]) {
  const getRGB = color.getRGB.bind(color);
  color.getRGB = (target, colorSpace) => getRGB(target, motionBlur.drawing ? THREE.SRGBColorSpace : colorSpace);
}
let drawStats = renderer.info.render; // the scene's draw calls and triangles this frame
const hemisphere = new THREE.HemisphereLight('#e4efed', '#787257', 1.6);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight('#fff0d2', 2.5);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(levels[qualityLevel].shadow);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 230 });
sun.shadow.bias = -.00015; sun.shadow.normalBias = .04;
scene.add(sun, sun.target);
// A second, coarse shadow map for the same sun reaches about 150 m ahead, so
// trees and rocks cast shadows long before the sharp map around the car
// arrives. Its light adds nothing itself; the shader blends the two maps.
const FAR_SHADOW = 110, FAR_SHADOW_AHEAD = 70;
const farSun = new THREE.DirectionalLight('#fff0d2', 0);
Object.assign(farSun.shadow.camera, { left: -FAR_SHADOW, right: FAR_SHADOW, top: FAR_SHADOW, bottom: -FAR_SHADOW, near: 1, far: 700 });
farSun.shadow.bias = -.0004; farSun.shadow.normalBias = .15;
function setFarShadow(size) {
  farSun.castShadow = size > 0;
  if (size && farSun.shadow.mapSize.x !== size) { farSun.shadow.mapSize.setScalar(size); farSun.shadow.map?.dispose(); farSun.shadow.map = null; }
}
setFarShadow(levels[qualityLevel].farShadow);
scene.add(farSun, farSun.target); // after the sun: it must be the second directional shadow
// Toward the key light: the sun by day, the moon by night (set each frame).
const sunDirection = new THREE.Vector3(-65, 100, 45).normalize();
// Shadow maps move only in whole texels across the light's view, so the
// shadow pattern never slides under the scene and edges don't crawl as the car
// moves. The basis is the shadow camera's own (lookAt with +y up); the light
// turns slowly through the day, so it is rebuilt each time.
const lightRight = new THREE.Vector3(), lightUp = new THREE.Vector3(), worldUp = new THREE.Vector3(0, 1, 0);
function snapToTexels(target, span, size) {
  lightRight.crossVectors(worldUp, sunDirection).normalize(); lightUp.crossVectors(sunDirection, lightRight);
  const texel = span / size, x = target.dot(lightRight), y = target.dot(lightUp);
  target.addScaledVector(lightRight, Math.round(x / texel) * texel - x).addScaledVector(lightUp, Math.round(y / texel) * texel - y);
}
// The sky dome follows the time of day (see sky.mjs and daylight.mjs) and
// travels with the camera, so the horizon never runs out.
const sky = createSky(scene);
// Time of day, in hours. Each world starts at its own seeded time of day or
// night (test modes at mid-morning, so their checks run in daylight);
// ?time=18.5 starts at 18:30.
const timeParam = Number(new URLSearchParams(location.search).get('time'));
const fixedTime = testMode || new URLSearchParams(location.search).has('time');
const worldHour = worldSeed => startHour(hash(17, 29, worldSeed + 5501));
const clock = { hours: Number.isFinite(timeParam) && new URLSearchParams(location.search).has('time') ? ((timeParam % 24) + 24) % 24 : testMode ? 10 : worldHour(seed), seconds: 0 };
// Cloud banks at flying height, seeded per world.
const clouds = createClouds(scene, seed);

// Weather: weather.mjs picks rain, snow or clear for the region under the car
// (re-rolled every couple of minutes); here it eases in and out, greys the sky,
// clouds and water, closes in the fog and dims the sun. ?weather=rain|snow|clear
// forces one.
const weatherFx = createWeatherEffects(scene);
weatherFx.setDensity([.35, .6, .8, 1][qualityLevel]);
const forcedWeather = ['clear', 'rain', 'snow'].includes(new URLSearchParams(location.search).get('weather')) ? new URLSearchParams(location.search).get('weather') : null;
const SKY = {
  clear: { top: new THREE.Color('#729eaf'), bottom: new THREE.Color('#b9cdd0'), cloud: new THREE.Color('#dde5dd') },
  rain: { top: new THREE.Color('#7b858a'), bottom: new THREE.Color('#a3abad'), cloud: new THREE.Color('#8a9296') },
  snow: { top: new THREE.Color('#a4aeb3'), bottom: new THREE.Color('#c9cfd1'), cloud: new THREE.Color('#d2d7d9') },
};
const weather = { clouds: .38, clock: 0, check: 0, target: { kind: 'clear', strength: 0, region: 'meadow' }, rain: 0, snow: 0, gust: new THREE.Vector3(), lastCamera: new THREE.Vector3(), cameraVelocity: new THREE.Vector3() };
const weatherColor = new THREE.Color(), skyTop = new THREE.Color(), overcast = { top: new THREE.Color(), bottom: new THREE.Color(), cloud: new THREE.Color() };
const dayColor = new THREE.Color(), cloudTint = new THREE.Color(), surfaceLight = new THREE.Color(), skyPalette = { zenith: new THREE.Color(), horizon: new THREE.Color(), cloudLit: new THREE.Color(), cloudShade: new THREE.Color() };
let dayLight = daylight(clock.hours);
// Shared by the ground and the roadside: how wet the roads are, how much
// fallen snow lies, how far speed calms the road's fine detail, the sky the
// roads mirror when wet, and the car's headlights (xyz, on: w; and their
// aim), which light up road paint and reflectors.
const roadLook = { uWet: { value: 0 }, uSnowCover: { value: 0 }, uCalm: { value: 0 }, uSkyReflection: { value: new THREE.Color() }, uHeadlight: { value: new THREE.Vector4() }, uHeadlightDir: { value: new THREE.Vector3(0, 0, 1) } };
const headlightGlsl = `uniform vec4 uHeadlight; uniform vec3 uHeadlightDir;
  // How brightly the headlights shine back off a reflective surface here
  // (road paint, reflectors): inside their beam, fading with distance.
  float headlightGlow(vec3 world){vec3 to=world-uHeadlight.xyz;float dist=max(length(to),.001);return uHeadlight.w*smoothstep(.82,.97,dot(to/dist,uHeadlightDir))/(1.0+dist*dist/1600.0);}`;
function updateWeather(dt) {
  const step = running ? dt : 0;
  weather.clock += step;
  if ((weather.check -= step) <= 0 || !started) { weather.check = .5; weather.target = weatherAt(world, vehicle.x, vehicle.z, weather.clock, forcedWeather); }
  // Weather builds and clears over about twenty seconds (at once when forced or before the start).
  const ease = !started || forcedWeather ? 1 : 1 - Math.exp(-step / 9);
  const { kind, strength } = weather.target;
  weather.rain += ((kind === 'rain' ? strength : 0) - weather.rain) * ease;
  weather.snow += ((kind === 'snow' ? strength : 0) - weather.snow) * ease;
  // Roads wet within seconds of steady rain and take about a minute to dry.
  const raining = smoothstep(.12, .7, weather.rain), wet = roadLook.uWet;
  wet.value += (raining - wet.value) * (!started || forcedWeather ? 1 : 1 - Math.exp(-step / (raining > wet.value ? 8 : 40)));
  // Falling snow settles over about half a minute and melts in two.
  const snowing = smoothstep(.12, .7, weather.snow), settled = roadLook.uSnowCover;
  settled.value += (snowing - settled.value) * (!started || forcedWeather ? 1 : 1 - Math.exp(-step / (snowing > settled.value ? 25 : 120)));
  // Cloud cover leads the rain (it gathers ahead of it) and clears after.
  weather.clouds += ((weather.target.cloudiness ?? .38) - weather.clouds) * (!started || forcedWeather ? 1 : 1 - Math.exp(-step / 7));
  skyPalette.cloudiness = weather.clouds;
  const rain = smoothstep(0, .85, weather.rain), snow = smoothstep(0, .85, weather.snow), cover = Math.min(1, Math.max(rain, snow) + Math.min(rain, snow) * .5);
  // Sky, clouds and fog: blend toward an overcast mixed from rain's and
  // snow's in proportion to how much of each is falling, so crossing from one
  // to the other never switches the colours over in one frame.
  const snowShare = rain + snow > 0 ? snow / (rain + snow) : 0;
  for (const part of ['top', 'bottom', 'cloud']) overcast[part].copy(SKY.rain[part]).lerp(SKY.snow[part], snowShare);
  // Time of day: the clear sky's colours, then the overcast dimmed to match
  // (a grey day by daylight, near black at night, warmed at sunrise and sunset).
  clock.hours = advanceClock(clock.hours, step); clock.seconds += step;
  const light = daylight(clock.hours), dim = .06 + .94 * light.day;
  for (const part of ['top', 'bottom', 'cloud']) overcast[part].multiplyScalar(dim).lerp(dayColor.setRGB(...light.horizon), .25 * (light.golden + light.dusk));
  skyColor.setRGB(...light.horizon).lerp(overcast.bottom, cover);
  skyTop.setRGB(...light.zenith).lerp(overcast.top, cover);
  skyPalette.zenith.copy(skyTop); skyPalette.horizon.copy(skyColor);
  roadLook.uSkyReflection.value.copy(skyColor).lerp(skyTop, .3);
  skyPalette.cloudLit.setRGB(...light.cloudLit).lerp(overcast.cloud, cover); skyPalette.cloudShade.setRGB(...light.cloudShade).lerp(cloudTint.copy(overcast.cloud).multiplyScalar(.7), cover);
  sky.update(light, skyPalette, cover, clock.seconds);
  renderer.toneMappingExposure = light.exposure;
  scene.fog.color.copy(toneMappedHorizon(skyColor, renderer.toneMappingExposure, weatherColor));
  // The cloud banks take the sky clouds' lit colour (scaled so a clear day stays white).
  clouds.setShade(rain); clouds.setLight(dayColor.copy(skyPalette.cloudLit).multiplyScalar(1 / .91));
  // The key light (sun or moon) and the sky's fill.
  // The shadow direction follows the sun every frame. (Stepping it 0.15° at a
  // time made every shadow jump at once every 0.6 s; with the maps snapped to
  // their texel grid, the per-frame turn of about 0.004° barely moves an edge.)
  sunDirection.set(...light.keyDirection);
  sun.color.setRGB(...light.keyColor); sun.intensity = light.keyIntensity * (1 - .72 * cover);
  hemisphere.color.setRGB(...light.hemiSky).lerp(overcast.top, cover * .5); hemisphere.groundColor.setRGB(...light.hemiGround);
  hemisphere.intensity = light.hemiIntensity * (1 + .12 * cover);
  surfaceLight.setRGB(...light.surfaceLight).multiplyScalar(1 - .25 * cover);
  waterSystem.setSky(skyTop, skyColor, (1 - .85 * cover) * Math.min(1, light.keyIntensity / 2.5 + light.night * .3), sunDirection, sun.color, skyPalette.cloudLit, surfaceLight);
  weatherFx.setLight(surfaceLight); dust.setLight(surfaceLight);
  dayLight = light;
  // Rain and snow drift with a little wind, relative to the moving camera.
  if (step > 0) weather.cameraVelocity.subVectors(camera.position, weather.lastCamera).divideScalar(step);
  if (weather.cameraVelocity.length() > 400) weather.cameraVelocity.set(0, 0, 0); // a teleport, not motion
  weather.lastCamera.copy(camera.position);
  weather.gust.set(Math.sin(weather.clock * .13) * 1.5 + 1.2, 0, Math.cos(weather.clock * .09) * 1.2 + .6).multiplyScalar(1 + snow);
  weatherFx.update({ rainAmount: rain, snowAmount: snow, cameraVelocity: weather.cameraVelocity, gust: weather.gust, pixels: renderer.domElement.height, fov: camera.fov }, step);
  return cover;
}

// Paint roads directly onto the terrain surface. Geometry, collision height and
// asphalt share one surface: no raised ribbons, seams or walls. Each terrain
// tile carries its own road map (roads.mjs: distance to the nearest road and
// which side of it, its dash cycle, and how near another road is), and near
// chunks a detail map too (solid lines, dips, junctions), built in the
// worker; its material holds those textures, and every tile shares one
// shader program.
const streamUniforms = { uStreamCenter: streamCenterUniform };
const grass = createGrass(streamUniforms.uStreamCenter, levels[qualityLevel].grass);
const roadTexture = data => {
  const texture = new THREE.DataTexture(data, ROAD_MAP, ROAD_MAP, THREE.RGBAFormat);
  // No mipmaps: averaging distances would erase thin distant roads (the
  // shader's own antialiasing keeps them a pixel wide instead).
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
};
// Far tiles have no detail map: a blank one stands in (no solid lines, dips or junctions).
const blankRoadInfo = new THREE.DataTexture(new Uint8Array([0, 0, 255, 128]), 1, 1, THREE.RGBAFormat); blankRoadInfo.needsUpdate = true;
function terrainSurface(roadMap, size, roadInfo = null) {
  const texture = roadTexture(roadMap), detail = roadInfo ? roadTexture(roadInfo) : blankRoadInfo;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  material.onBeforeCompile = shader => { compileTerrain(shader); Object.assign(shader.uniforms, { uRoadMap: { value: texture }, uRoadInfo: { value: detail }, uRoadSize: { value: size } }); };
  material.customProgramCacheKey = () => 'terrain-roads-3';
  material.userData.roadMaps = roadInfo ? [texture, detail] : [texture];
  return material;
}
const disposeSurface = material => { material.userData.roadMaps?.forEach(texture => texture.dispose()); material.dispose(); };
// Drawn just in front of the ground it rests on at either end.
const bridgeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
// Geometry is already coarse at the streaming boundary. Moving the boundary
// therefore changes tessellation only, never the silhouette or lighting.
const lodDeclaration = `uniform vec2 uStreamCenter; uniform float uRoadSize; varying vec2 vRoadUV;
attribute float coarseHeight;
attribute vec3 coarseNormal;
attribute vec3 coarseColor;
attribute float ultraHeight;
float terrainBlend(){return smoothstep(220.0,360.0,distance((modelMatrix*vec4(position,1.0)).xz,uStreamCenter));}
float ultraBlend(){return smoothstep(${ULTRA_BLEND_START.toFixed(1)},${ULTRA_BLEND_END.toFixed(1)},distance((modelMatrix*vec4(position,1.0)).xz,uStreamCenter));}
`;

function compileTerrain(shader) {
  Object.assign(shader.uniforms, streamUniforms, waterSystem.causticUniforms, roadLook);
  shader.vertexShader = lodDeclaration + 'varying vec2 vGroundXZ; varying vec3 vGroundWorld;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal=mix(objectNormal,coarseNormal,terrainBlend());');
  shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\nvColor=mix(vColor,coarseColor,terrainBlend());');
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y=mix(mix(position.y,coarseHeight,terrainBlend()),ultraHeight,ultraBlend());\nvGroundXZ=(modelMatrix*vec4(position,1.0)).xz;vGroundWorld=(modelMatrix*vec4(transformed,1.0)).xyz;vRoadUV=position.xz/uRoadSize;');
  shader.fragmentShader = `varying vec2 vGroundXZ; varying vec3 vGroundWorld; varying vec2 vRoadUV;
    uniform float uTime; uniform vec4 uCausticLake; uniform sampler2D uRoadMap, uRoadInfo; uniform float uWet, uSnowCover, uCalm; uniform vec3 uSkyReflection;
    ${headlightGlsl}
    float terrainRough=1.0, terrainMirror=0.0;
    float grain(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    float smoothGrain(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(grain(i),grain(i+vec2(1,0)),f.x),mix(grain(i+vec2(0,1)),grain(i+vec2(1,1)),f.x),f.y);}
  ` + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=terrainRough;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
    // Wet roads mirror the sky, most at grazing angles.
    if(terrainMirror>0.0){float facing=clamp(dot(normal,normalize(vViewPosition)),0.0,1.0);outgoingLight+=uSkyReflection*terrainMirror*(.04+.96*pow(1.0-facing,5.0));}
    #include <opaque_fragment>`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    // The nearest road, from this tile's road maps: its distance and which
    // side of it, where its centre-line dashes fall, how near another road is,
    // and (near chunks) solid lines, dips and junctions.
    vec2 p=vGroundXZ;
    vec4 road=texture2D(uRoadMap,vRoadUV), info=texture2D(uRoadInfo,vRoadUV);
    float d=road.r*12.75, dashes=road.g*2.0-1.0, otherRoad=road.b*25.5, lateral=(road.a*2.0-1.0)*4.0, junction=(info.b*255.0-128.0)*.05;
    // The road's kind and its centre line (roads.mjs): dashed, solid, a
    // highway (a solid double line and dashed lanes), a roundabout's ring
    // (none), or a dirt track.
    float mode=info.r*255.0, solidLine=smoothstep(28.0,36.0,mode)*(1.0-smoothstep(92.0,100.0,mode)), highway=smoothstep(92.0,100.0,mode)*(1.0-smoothstep(156.0,164.0,mode));
    float lineless=smoothstep(156.0,164.0,mode), dirt=smoothstep(220.0,228.0,mode);
    // Inside a junction the roads join with rounded corners (a smooth union
    // of their distances), and the edge lines follow the curve.
    float zone=1.0-smoothstep(-.4,0.0,junction), join=clamp(.5+.1*(otherRoad-d),0.0,1.0), rd=mix(d,mix(otherRoad,d,join)-5.0*join*(1.0-join),zone);
    // Derivatives outside the branch.
    float aa=max(fwidth(rd),.04), aaSide=max(fwidth(lateral),.02), aaJunction=max(fwidth(junction),.03);
    // Ground metres per pixel. Detail finer than about two pixels can't be
    // shown: sampled anyway, each frame lands on different grains and the
    // ground crawls as you move. So each pattern fades to its average there.
    vec2 fp=fwidth(p);float foot=max(fp.x,fp.y), fine=1.0-smoothstep(.04,.12,foot);
    float shoulder=0.0;
    // Rain darkens the ground a little and the roads more; wet asphalt and
    // puddles turn glossy and mirror the sky (terrainMirror, after lighting).
    terrainRough=1.0;
    diffuseColor.rgb*=1.0-.18*uWet;
    // Fallen snow dusts the ground (thinner on slopes).
    if(uSnowCover>0.0){float level=abs(normalize(cross(dFdx(vGroundWorld),dFdy(vGroundWorld))).y);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.74,.77,.78),uSnowCover*.62*smoothstep(.55,.85,level));}
    // Away from roads (most of the ground) the asphalt work is skipped.
    if(rd<7.6+aa){
      vec3 base=diffuseColor.rgb;
      // The region, from the ground's own colour: sand or snow.
      float sand=smoothstep(.26,.4,base.r-base.b)*smoothstep(.3,.42,base.g), snow=max(smoothstep(.48,.64,min(base.r,min(base.g,base.b))),uSnowCover);
      // How old the road is here: older roads are paler and patched, their paint scuffed.
      float age=smoothGrain(p*.0023+vec2(3.7,1.3));
      // Gravel shoulders, ragged where they meet the grass (sand or snow verges in those regions).
      // At speed the finest, sharpest detail softens (uCalm: 0 below about
      // 40 km/h, 1 above 120): racing past, consecutive frames can no longer
      // be matched up and it would seem to stutter, as the grass would.
      float still=1.0-uCalm;
      float rag=((smoothGrain(p*.9)-.5)*1.1*(.4+.6*still)+(smoothGrain(p*3.1+2.0)-.5)*.5*still)*fine;
      shoulder=1.0-smoothstep(5.7+rag,6.7+rag+uCalm*.8,rd);
      vec3 gravel=vec3(.30,.28,.235)*(.82+.36*still*mix(smoothGrain(p*6.5+11.0),.5,1.0-fine));
      diffuseColor.rgb=mix(base,mix(gravel,base,max(sand*.75,snow*.9)),shoulder*.8*(1.0-.7*dirt));
      // Sand drifts in over the edges in the desert.
      float drift=sand*(smoothGrain(p*.42+5.0)*.7+(.5+(smoothGrain(p*1.6)-.5)*still)*.3), edgeAt=4.65-1.8*drift*drift*drift-dirt*max(rag,0.0)*.8, soft=aa+uCalm*sand*.7+dirt*.15;
      float asphalt=1.0-smoothstep(edgeAt-soft,edgeAt+soft,rd);
      // Dark when new, paler with age, sun-bleached in the desert; 11 cm
      // grains, smoothly blended (hard-edged cells flicker at any range).
      vec3 tarmac=mix(vec3(.105,.124,.12),vec3(.16,.165,.155),age*.75);
      tarmac=mix(tarmac,vec3(.22,.205,.175),sand*.85)+mix(smoothGrain(p*9.0),.5,smoothstep(.03,.08,foot))*.018*still;
      // Repair patches: fresh dark tar or old pale asphalt.
      float pn=smoothGrain(p*.31+17.0)*.62+smoothGrain(p*1.1+4.0)*.38, pw=foot*.4+.006+uCalm*.04, pt=.77-age*.09;
      float patched=smoothstep(pt-pw,pt+pw,pn)*(1.0-.5*zone)*(.4+.6*fine);
      tarmac*=mix(1.0,smoothGrain(p*.031)>.5?.86:1.16,patched*(1.0-.6*uCalm));
      // Two darker, smoother wheel tracks in each lane.
      float tracks=(exp(-pow((d-1.45)/.4,2.0))+exp(-pow((d-3.15)/.4,2.0)))*(1.0-zone);
      tarmac*=1.0-.13*tracks;
      // Grey slush along the edges where snow lies.
      float slush=snow*smoothstep(3.0,4.4,rd+(smoothGrain(p*.8)-.5)*1.4*(.4+.6*still));
      tarmac=mix(tarmac,vec3(.36,.36,.35),slush*.7)*(1.0-.42*uWet);
      // A dirt track: packed earth (or sand, or trodden snow) with two ruts
      // and a strip of the ground's own grass between them, wet to mud in rain.
      if(dirt>0.0){
        float ruts=exp(-pow((abs(lateral)-.85)/.28,2.0)), crown=1.0-smoothstep(.22,.42,abs(lateral));
        vec3 earth=vec3(.31,.26,.19)*(.84+.32*still*mix(smoothGrain(p*5.3+2.0),.5,1.0-fine))*(1.0-.22*ruts);
        earth=mix(earth,base*vec3(.92,.9,.86),max(sand*.8,snow*.75));
        earth=mix(earth,base,crown*.55*(1.0-sand)*(1.0-snow));
        tarmac=mix(tarmac,earth*(1.0-.35*uWet),dirt);
      }
      diffuseColor.rgb=mix(diffuseColor.rgb,tarmac,asphalt);
      // Markings: edge lines (around a junction's corners), the centre line
      // (dashed, or a solid double line on bends and crests, ending before
      // each junction), and a stop line across a side road's incoming lane.
      float edge=(1.0-smoothstep(.065,.065+aa,abs(rd-4.13)))*mix(smoothstep(3.9,4.4,otherRoad),1.0,zone);
      float single=(1.0-smoothstep(.065,.065+aaSide,abs(lateral)))*smoothstep(-.06,.06,dashes);
      float twin=1.0-smoothstep(.05,.05+aaSide,abs(abs(lateral)-.16));
      float centre=mix(single,twin,max(solidLine,highway))*smoothstep(.45,.45+aaJunction,junction)*(1.0-step(1.0,d))*(1.0-lineless);
      // A highway's lane lines, dashed, 3.45 m either side of its centre.
      centre=max(centre,(1.0-smoothstep(.065,.065+aaSide,abs(abs(lateral)-3.45)))*smoothstep(-.06,.06,dashes)*highway*smoothstep(.45,.45+aaJunction,junction));
      float approach=info.a*2.0-1.0;
      // Solid at a stop; dashed where it gives way to a roundabout (flagged nearer 0).
      float flag=abs(approach), giveWay=smoothstep(.35,.45,flag)*(1.0-smoothstep(.75,.85,flag)), dashedAcross=smoothstep(.42,.5,fract(d/.9))*(1.0-smoothstep(.92,1.0,fract(d/.9)));
      float stop=(smoothstep(.8,.9,flag)+giveWay*dashedAcross)*smoothstep(.1,.2,lateral*sign(approach))*(1.0-smoothstep(4.2,4.2+aa,d))*(1.0-smoothstep(.25,.25+aaJunction,abs(junction-.27)));
      float wear=clamp(age*.55+(smoothGrain(p*2.3)-.5)*.6+(smoothGrain(p*9.0+3.0)-.5)*.4*fine*still,0.0,1.0);
      float paint=max(edge*.72,max(centre*.88,stop*(1.0-.5*tracks)*.9))*(1.0-.6*wear)*(1.0-.55*patched)*(1.0-.8*slush)*asphalt*(1.0-dirt);
      vec3 paintColor=vec3(.77,.72,.56);
      diffuseColor.rgb=mix(diffuseColor.rgb,paintColor,paint);
      // Road paint is retroreflective: in the headlights it shines back.
      totalEmissiveRadiance+=paintColor*paint*headlightGlow(vGroundWorld);
      // Puddles gather in dips, along the edges and in the wheel tracks.
      float pool=smoothGrain(p*.33+9.0)*.65+smoothGrain(p*1.2)*.35+tracks*.12+smoothstep(3.6,4.6,d)*.1, pp=1.02-uWet*(.22+.5*info.g), ppw=foot*.4+.01;
      float puddle=smoothstep(pp-ppw,pp+ppw,pool)*asphalt*uWet;
      diffuseColor.rgb*=1.0-.5*puddle;
      terrainRough=mix(1.0,mix(.92,mix(mix(.34,.16,tracks),.55,dirt),uWet),asphalt);
      terrainRough=mix(terrainRough,.05,puddle);
      terrainMirror=min(1.0,asphalt*uWet*(.32+.25*tracks)+puddle*.7);
    }
    // Meadow ground (green, off the road): fine grass speckle that fades out
    // with distance and where pixels outgrow it, and broad lush and dry
    // blotches as far as they can be shown, so the land past the grass tufts
    // doesn't read as a flat carpet.
    // Only on ground that faces up: laid out by map position, these patterns
    // would stretch into streaks down a steep face.
    float facingUp=smoothstep(.55,.8,abs(normalize((vec4(vNormal,0.0)*viewMatrix).xyz).y));
    float meadow=smoothstep(.015,.07,diffuseColor.g-max(diffuseColor.r,diffuseColor.b)*.9)*(1.0-shoulder)*facingUp;
    if(meadow>0.0){
      float seen=distance(cameraPosition,vGroundWorld);
      // The fine speckle has faded out by 140 m: only work it out closer.
      float close=1.0-smoothstep(35.0,140.0,seen);
      // Each octave by its own size: 56 cm and 24 cm, then 18 m and 7.7 m.
      float fine=close>0.0?.5+(smoothGrain(p*1.8)-.5)*.6*(1.0-smoothstep(.15,.4,foot))+(smoothGrain(p*4.1+7.0)-.5)*.4*(1.0-smoothstep(.07,.18,foot)):.5;
      float blotch=.5+(smoothGrain(p*.055)-.5)*.65*(1.0-smoothstep(5.0,13.0,foot))+(smoothGrain(p*.13+3.0)-.5)*.35*(1.0-smoothstep(2.0,5.5,foot));
      diffuseColor.rgb*=1.0+meadow*((fine-.5)*.2*close+(blotch-.5)*.16);
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.1,1.05,.82),meadow*smoothstep(.58,.8,blotch)*.55);
    }
    // Sunlight focused by the waves dances over the bed of the lake nearest
    // the camera (xy centre, z reach, w surface level; reach 0 turns it off).
    float underwater=uCausticLake.w-vGroundWorld.y;
    if(uCausticLake.z>0.0&&underwater>.02&&distance(p,uCausticLake.xy)<uCausticLake.z){
      float fade=(1.0-smoothstep(35.0,75.0,distance(cameraPosition,vGroundWorld)))*smoothstep(.02,.35,underwater)*exp(-underwater*.16);
      if(fade>.0){
        vec2 q=p*.62; float t=uTime*.9;
        vec2 a=q+vec2(sin(q.y*1.3+t),cos(q.x*1.1-t*.8))*.9, b=q*1.37+vec2(cos(q.y*.9-t*.7),sin(q.x*1.5+t*.6))*.8;
        float c=pow(1.0-abs(sin(a.x)*sin(a.y)),7.0)+pow(1.0-abs(sin(b.x+.7)*sin(b.y-.4)),7.0);
        diffuseColor.rgb*=1.0+c*.42*fade;
      }
    }
  `);
}
let terrain = createTerrain(world);
function geometryFromData(data) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, array] of Object.entries(data)) {
    if (name === 'split') continue; // kept by far tiles for their index lists
    if (name === 'index') geometry.setIndex(new THREE.BufferAttribute(array, 1));
    else geometry.setAttribute(name, new THREE.BufferAttribute(array, name === 'coarseHeight' || name === 'ultraHeight' ? 1 : 3));
  }
  geometry.computeBoundingSphere();
  return geometry;
}
const material = (color, roughness = .85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
// Roadside furniture (roadside-data.mjs): one vertex-coloured mesh per chunk,
// whose reflectors (retro) shine back in the headlights.
const roadsideMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7, side: THREE.DoubleSide });
roadsideMaterial.userData.compileKey = 'reflectors-1';
roadsideMaterial.userData.compile = shader => {
  Object.assign(shader.uniforms, roadLook);
  shader.vertexShader = 'attribute float retro; varying float vRetro; varying vec3 vRoadsideWorld;\n' + shader.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\nvRetro=retro;vRoadsideWorld=(modelMatrix*sceneryPosition).xyz;');
  shader.fragmentShader = 'varying float vRetro; varying vec3 vRoadsideWorld;\n' + headlightGlsl + '\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*vRetro*headlightGlow(vRoadsideWorld)*2.5;');
};
let nature = null, natureError = null;
loadNatureLibrary().then(library => {
  nature = library; standinLooks = natureLooks(library); buildPendingStandins();
  treeBreakage = createTreeBreakage(scene, nature.treeSources);
}).catch(error => {
  natureError = error.message;
  $('loadError').hidden = false;
  $('startBtn').firstElementChild.textContent = 'Unable to load scenery';
  console.error('Blender scenery failed to load:', error);
});
// Distant bushes: a squat rounded shape, fitted to each bush model's bounds.
const bushGeo = new THREE.IcosahedronGeometry(1, 0).scale(1.1, .7, .9).translate(0, .45, 0);
const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), upAxis = new THREE.Vector3(0, 1, 0), scaleVec = new THREE.Vector3(), pointVec = new THREE.Vector3();
const fadingMaterials = new WeakSet();
// Real props fade with distance. Trees, cacti, rocks, boulders, bushes and
// posts (swap: true) stay fully opaque and stop at their own swap distance,
// where far-tile stand-ins take over (bushes and posts are too small to need
// one). Landmarks, and every prop on Low graphics, fade out instead over
// 220–350 m, using multisample coverage.
function softenScenery(mat, mode = 'fade') {
  const swap = mode !== 'fade', landmark = mode === 'landmark';
  if (fadingMaterials.has(mat)) return;
  fadingMaterials.add(mat);
  // Use stable multisample coverage instead of screen-space noise, which
  // sparkles during motion and on browsers with different pixel ratios.
  // Keep alpha in the output (transparent), but retain opaque depth and
  // blending when MSAA is available. Fall back to ordinary alpha blending.
  const multisampled = screenMultisampled || renderer.capabilities.maxSamples >= 4;
  mat.transparent = true;
  mat.alphaToCoverage = multisampled;
  mat.blending = multisampled ? THREE.NoBlending : THREE.NormalBlending;
  mat.depthWrite = multisampled;
  const own = mat.userData.compile; // a material's own additions (roadside reflectors)
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, streamUniforms, { uStandins: standinUniform });
    shader.vertexShader = `attribute float groundDelta; ${swap ? 'attribute float swapAt; uniform float uStandins;' : ''} ${landmark ? 'attribute vec2 swapCenter;' : ''} uniform vec2 uStreamCenter; varying vec2 vSceneryXZ; varying float vSceneryCover;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 sceneryPosition=vec4(transformed,1.0);
      vec4 sceneryOrigin=vec4(0.0,0.0,0.0,1.0);
      #ifdef USE_INSTANCING
        sceneryPosition=instanceMatrix*sceneryPosition; sceneryOrigin=instanceMatrix[3];
      #endif
      vSceneryXZ=(modelMatrix*sceneryPosition).xz;
      float groundBlend=smoothstep(220.0,360.0,distance(vSceneryXZ,uStreamCenter));
      // Group transforms preserve the vertical axis and have unit scale.
      sceneryPosition.y+=groundDelta*groundBlend;
      vec4 mvPosition=modelViewMatrix*sceneryPosition;
      gl_Position=projectionMatrix*mvPosition;
      vSceneryCover=0.0;
      ${swap ? `// Opaque until the prop's swap distance (measured at its origin, exactly
      // as its stand-in measures it), then gone. Without a swapAt (0), always drawn.
      float sceneryDistance=distance(${landmark ? 'swapCenter' : '(modelMatrix*sceneryOrigin).xz'},uStreamCenter);
      if(uStandins>.5){ vSceneryCover=3.0; if(swapAt>0.0&&sceneryDistance>swapAt) gl_Position=vec4(2.0,2.0,2.0,1.0); }
      else vSceneryCover=3.0-smoothstep(220.0,350.0,sceneryDistance);` : ''}`);
    shader.fragmentShader = 'uniform vec2 uStreamCenter; varying vec2 vSceneryXZ; varying float vSceneryCover;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      // A per-prop cover arrives as 2 + cover; otherwise fade per pixel.
      float coverage=vSceneryCover>1.5?vSceneryCover-2.0:1.0-smoothstep(220.0,350.0,distance(vSceneryXZ,uStreamCenter));
      if(coverage<=0.001) discard;
      diffuseColor.a*=coverage;`);
    own?.(shader);
  };
  mat.customProgramCacheKey = () => `scenery-${mode}-v2${own ? '-' + mat.userData.compileKey : ''}`;
  mat.needsUpdate = true;
}
const chunks = new Map();
const view = NEAR_VIEW, farTiles = new Map(), ultraTiles = new Map();
let lastCX = Infinity, lastCZ = Infinity;
// Two workers: one builds the near chunks around the car, the other
// everything further out (far and horizon tiles, lakes). A horizon tile can
// take a few hundred milliseconds; on one worker the ground just ahead
// would queue behind it and arrive late.
let workers = [], generation = 0, jobId = 0, jobs = [], pending = new Map(), completed = [];
const laneOf = job => job.kind === 'near' ? 0 : 1, LANE_JOBS = 2; // jobs in flight per worker
let loading = true, resumeAfterLoad = false, loadingStarted = bootStarted, streamError = null, roadsReady = false;
// Distant water is rebuilt in the worker after every 500 m of travel.
let distantAt = { x: Infinity, z: Infinity }, distantReady = false;
function buildChunk({ cx, cz, ground: groundData, roadMap, roadInfo, river, bridges, props, features, roadside, grass: grassData }) {
  const buildStart = performance.now();
  const group = new THREE.Group(); group.position.set(cx * CHUNK, 0, cz * CHUNK);
  props = props.filter(p => !world.brokenProps.has(p.id));
  const propInstances = new Map();
  const ground = new THREE.Mesh(geometryFromData(groundData), terrainSurface(roadMap, CHUNK, roadInfo));
  ground.geometry.userData.owned = true;
  ground.receiveShadow = true; group.add(ground);
  function instances(type, geometry, mat, variant) {
    const list = props.filter(p => p.type === type && (variant === undefined || nature.variantFor(p) === variant)); if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geometry, mat, list.length);
    list.forEach((p, i) => {
      pointVec.set(p.x - cx * CHUNK, p.y - .08, p.z - cz * CHUNK); quaternion.setFromAxisAngle(upAxis, p.turn); scaleVec.setScalar(p.size); matrix.compose(pointVec, quaternion, scaleVec); mesh.setMatrixAt(i, matrix);
      if (p.id) { if (!propInstances.has(p.id)) propInstances.set(p.id, []); propInstances.get(p.id).push({ mesh, index: i }); }
    });
    mesh.userData.swap = Float32Array.from(list, swapDistance);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.natureKind = variant === undefined ? null : type; group.add(mesh);
  }
  for (const [kind, variants] of Object.entries(nature.variants)) {
    variants.forEach(({ geometry, material }, variant) => instances(kind, geometry, material, variant));
  }
  if (roadside?.mesh) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['retro', 1], ['groundDelta', 1]]) geometry.setAttribute(name, new THREE.BufferAttribute(roadside.mesh[name], size));
    geometry.computeBoundingSphere(); geometry.userData.owned = true;
    const mesh = new THREE.Mesh(geometry, roadsideMaterial); mesh.name = 'Roadside'; mesh.castShadow = mesh.receiveShadow = true;
    // World-space vertices: the group's offset is undone.
    mesh.position.set(-cx * CHUNK, 0, -cz * CHUNK); group.add(mesh);
  }
  // Each sign is its own piece standing on its foot, so it can be knocked
  // over (and stays down, as it fell, when the chunk comes back).
  const signs = new Map();
  for (const sign of roadside?.signs?.list || []) {
    const geometry = new THREE.BufferGeometry(), range = (name, size) => roadside.signs[name].slice(sign.start * size, (sign.start + sign.count) * size);
    for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['retro', 1], ['groundDelta', 1]]) geometry.setAttribute(name, new THREE.BufferAttribute(range(name, size), size));
    geometry.computeBoundingSphere(); geometry.userData.owned = true;
    const mesh = new THREE.Mesh(geometry, roadsideMaterial); mesh.name = 'Sign'; mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(sign.x - cx * CHUNK, sign.y, sign.z - cz * CHUNK);
    if (world.brokenProps.has(sign.id)) mesh.quaternion.setFromAxisAngle(fallenSigns.get(sign.id) || pointVec.set(1, 0, 0), SIGN_DOWN);
    signs.set(sign.id, mesh); group.add(mesh);
  }
  for (const feature of features) {
    const landmark = buildLandmark(feature, world); landmark.userData.feature = feature;
    landmark.position.x -= cx * CHUNK; landmark.position.z -= cz * CHUNK; group.add(landmark);
  }
  group.updateMatrixWorld(true);
  group.traverse(o => {
    if (!o.isMesh || o === ground) return;
    // Match the terrain's gradual height change so distant trees stay rooted
    // (the roadside arrives with its own, worked out in the worker).
    if (o.geometry.getAttribute('groundDelta')) { softenScenery(o.material, 'fade'); return; }
    if (!o.geometry.userData.owned) o.geometry = cloneOwnedGeometry(o.geometry);
    const deltas = [], position = o.geometry.getAttribute('position');
    for (let i = 0; i < (o.isInstancedMesh ? o.count : position.count); i++) {
      if (o.isInstancedMesh) { o.getMatrixAt(i, matrix); pointVec.setFromMatrixPosition(matrix); }
      else pointVec.fromBufferAttribute(position, i);
      pointVec.applyMatrix4(o.matrixWorld);
      deltas.push(terrain.coarseSample(pointVec.x, pointVec.z).height - world.surface(pointVec.x, pointVec.z));
    }
    o.geometry.setAttribute('groundDelta', o.isInstancedMesh ? new THREE.InstancedBufferAttribute(new Float32Array(deltas), 1) : new THREE.Float32BufferAttribute(deltas, 1));
    if (o.userData.swap) o.geometry.setAttribute('swapAt', new THREE.InstancedBufferAttribute(o.userData.swap, 1));
    // Landmarks swap as a whole, at their centre's distance.
    const feature = o.parent?.userData.feature;
    if (feature) {
      const count = o.isInstancedMesh ? o.count : position.count, at = landmarkSwapDistance(feature);
      const make = (values, size) => o.isInstancedMesh ? new THREE.InstancedBufferAttribute(values, size) : new THREE.Float32BufferAttribute(values, size);
      o.geometry.setAttribute('swapAt', make(new Float32Array(count).fill(at), 1));
      o.geometry.setAttribute('swapCenter', make(Float32Array.from({ length: count * 2 }, (_, i) => i % 2 ? feature.z : feature.x), 2));
    }
    softenScenery(o.material, feature ? 'landmark' : o.userData.swap ? 'swap' : 'fade');
  });
  const grassMesh = grass.build(grassData);
  if (grassMesh) { grass.update(grassMesh, cx, cz, vehicle.x, vehicle.z); group.add(grassMesh); }
  profiler.record('chunkBuild', performance.now() - buildStart);
  // River water rides in world space (the water shader works in world
  // coordinates), so it sits in the scene beside the chunk's group.
  const riverMesh = river && waterSystem.riverMesh(river);
  if (riverMesh) scene.add(riverMesh);
  // Bridges carry roads over rivers (bridge-data.mjs), also in world space.
  if (bridges) {
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color']) geometry.setAttribute(name, new THREE.BufferAttribute(bridges[name], 3));
    geometry.computeBoundingSphere(); geometry.userData.owned = true;
    const mesh = new THREE.Mesh(geometry, bridgeMaterial); mesh.name = 'Bridges'; mesh.castShadow = mesh.receiveShadow = true;
    // Placed at the origin; the group's offset is undone so its world-space vertices stay put.
    mesh.position.set(-cx * CHUNK, 0, -cz * CHUNK); group.add(mesh);
  }
  scene.add(group); chunks.set(`${cx},${cz}`, { cx, cz, group, ground, grassMesh, riverMesh, props, barriers: roadside?.obstacles || [], signs, features, propInstances });
}
// Signs knocked over: each is thrown about 20° over at once, the way the car
// was going, then falls faster and faster about its foot, flat in 0.4 s.
const fallingSigns = [], fallenSigns = new Map(), SIGN_DOWN = 1.45, SIGN_KICK = .35;
function updateFallingSigns(dt) {
  for (let i = fallingSigns.length - 1; i >= 0; i--) {
    const fall = fallingSigns[i]; fall.t += dt;
    const k = Math.min(1, fall.t / .4);
    fall.mesh.quaternion.setFromAxisAngle(fall.axis, SIGN_KICK + (SIGN_DOWN - SIGN_KICK) * k * k);
    if (k >= 1) fallingSigns.splice(i, 1);
  }
}
function processBreakage() {
  for (const prop of world.drainBreakEvents()) {
    const chunk = chunks.get(`${Math.floor(prop.x / CHUNK)},${Math.floor(prop.z / CHUNK)}`);
    if (prop.type === 'sign') {
      const speed = Math.hypot(prop.vx, prop.vz) || 1, axis = new THREE.Vector3(prop.vz / speed, 0, -prop.vx / speed);
      fallenSigns.set(prop.id, axis);
      const mesh = chunk?.signs.get(prop.id);
      if (mesh) { mesh.quaternion.setFromAxisAngle(axis, SIGN_KICK); fallingSigns.push({ mesh, axis, t: 0 }); }
      if (!muted && audio) audio.breaks.play('sign', speed, panAt(prop.x, prop.z));
      continue;
    }
    for (const { mesh, index } of chunk?.propInstances.get(prop.id) || []) {
      mesh.getMatrixAt(index, matrix); matrix.scale(scaleVec.set(0, 0, 0)); mesh.setMatrixAt(index, matrix); mesh.instanceMatrix.needsUpdate = true;
    }
    const standin = farTiles.get(`${Math.floor(prop.x / FAR_SIZE)},${Math.floor(prop.z / FAR_SIZE)}`)?.userData.impostors?.ids.get(prop.id);
    if (standin) { standin.mesh.getMatrixAt(standin.index, matrix); matrix.scale(scaleVec.set(0, 0, 0)); standin.mesh.setMatrixAt(standin.index, matrix); standin.mesh.instanceMatrix.needsUpdate = true; }
    debris.burst(prop);
    if (prop.type === 'tree') treeBreakage.burst({ ...prop, variant: nature.variantFor(prop) });
    if (!muted && audio) audio.breaks.play(prop.type, Math.hypot(prop.vx, prop.vz), panAt(prop.x, prop.z));
  }
}
function disposeChunk(chunk) {
  scene.remove(chunk.group);
  chunk.group.traverse(o => { if (o.geometry?.userData.owned) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
  disposeSurface(chunk.ground.material);
  if (chunk.riverMesh) { scene.remove(chunk.riverMesh); chunk.riverMesh.geometry.dispose(); }
}
// Distant forests: one instanced pine silhouette per far tile, placed at the
// same seeded positions as the real trees. They fade in exactly as the real
// trees fade out (220–350 m), so flying away never thins the forest.
// Distant scenery: far tiles carry simple stand-ins for every tree, cactus,
// rock, boulder and bush the near chunks will place, at the same seeded spots. Each
// prop swaps between its real model and its stand-in at its own distance
// (swapDistance, 260–340 m): both are always opaque, so nothing turns ghostly,
// and because the swaps are scattered there is no visible line. Stand-ins are
// fitted to their real model's bounds and coloured like it. Skipped on Low,
// where real props fade out over 220–350 m instead.
const swapDistance = p => 260 + 80 * hash(Math.round(p.x * 4), Math.round(p.z * 4), 9137);
const standinUniform = { value: qualityLevel > 0 ? 1 : 0 };
const STANDIN_TYPES = ['tree', 'cactus', 'rock', 'boulder', 'bush', 'outcrop'];
// Unit shapes: x and z in [-.5, .5], y in [0, 1]; each is scaled to its model.
const standinShapes = (() => {
  const merge = parts => {
    const merged = new THREE.BufferGeometry(), flat = parts.map(g => g.index ? g.toNonIndexed() : g);
    for (const name of ['position', 'normal']) merged.setAttribute(name, new THREE.Float32BufferAttribute(flat.flatMap(g => [...g.getAttribute(name).array]), 3));
    return merged;
  };
  return {
    tree: merge([new THREE.CylinderGeometry(.05, .07, .2, 5).translate(0, .1, 0), new THREE.ConeGeometry(.5, .62, 7).translate(0, .46, 0), new THREE.ConeGeometry(.34, .5, 7).translate(0, .75, 0)]),
    cactus: merge([new THREE.CylinderGeometry(.13, .15, 1, 7).translate(0, .5, 0),
      new THREE.CylinderGeometry(.06, .06, .3, 5).rotateZ(Math.PI / 2).translate(-.24, .38, 0), new THREE.CylinderGeometry(.09, .09, .42, 6).translate(-.38, .57, 0),
      new THREE.CylinderGeometry(.06, .06, .3, 5).rotateZ(Math.PI / 2).translate(.24, .5, 0), new THREE.CylinderGeometry(.09, .09, .36, 6).translate(.38, .66, 0)]),
    rock: merge([new THREE.IcosahedronGeometry(.5, 0).scale(1, 1, 1).translate(0, .5, 0)]),
    boulder: merge([new THREE.IcosahedronGeometry(.5, 1).translate(0, .5, 0)]),
    outcrop: merge([new THREE.IcosahedronGeometry(.5, 1).translate(0, .5, 0)]),
    bush: (() => { const g = bushGeo.clone(); g.computeBoundingBox(); const b = g.boundingBox, size = b.getSize(new THREE.Vector3()); return g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2).scale(1 / size.x, 1 / size.y, 1 / size.z); })(),
  };
})();
// From the real models once loaded: each variant's bounds and colour (trees:
// the foliage's), so a stand-in matches the model it replaces.
function natureLooks(library) {
  const looks = {};
  for (const type of STANDIN_TYPES) looks[type] = (library.variants[type] ?? []).map(({ geometry }) => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox, colors = geometry.getAttribute('color'), positions = geometry.getAttribute('position'), sum = [0, 0, 0];
    const floor = type === 'tree' ? box.min.y + (box.max.y - box.min.y) * .3 : -Infinity;
    let n = 0;
    for (let i = 0; i < colors.count; i++) if (positions.getY(i) >= floor) { sum[0] += colors.getX(i); sum[1] += colors.getY(i); sum[2] += colors.getZ(i); n++; }
    return { min: box.min.clone(), size: box.getSize(new THREE.Vector3()), color: new THREE.Color(sum[0] / n, sum[1] / n, sum[2] / n) };
  });
  return looks;
}
let standinLooks = null;
const standinMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .94 });
standinMaterial.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, streamUniforms);
  shader.vertexShader = 'attribute vec3 groundY; attribute float swapAt; uniform vec2 uStreamCenter;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
    vec4 world = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
    float d = distance((modelMatrix * instanceMatrix[3]).xz, uStreamCenter);
    // Follow the terrain tier actually drawn under the prop: fine, far, horizon.
    world.y += mix(mix(groundY.x, groundY.y, smoothstep(220.0, 360.0, d)), groundY.z, smoothstep(${ULTRA_BLEND_START.toFixed(1)}, ${ULTRA_BLEND_END.toFixed(1)}, d));
    vec4 mvPosition = viewMatrix * world;
    // Drawn only beyond the prop's swap distance, where its real model stops.
    gl_Position = d > swapAt ? projectionMatrix * mvPosition : vec4(2.0, 2.0, 2.0, 1.0);`);
};
standinMaterial.customProgramCacheKey = () => 'standin-v1';
let impostorsEnabled = qualityLevel > 0;
function buildImpostors(tile, props) {
  if (!standinLooks) { tile.userData.pendingStandins = props; return; } // built once the models load
  const byType = new Map(STANDIN_TYPES.map(t => [t, []]));
  props.id.forEach((id, i) => { if (!world.brokenProps.has(id)) byType.get(props.type?.[i] ?? 'tree')?.push(i); });
  const meshes = [], ids = new Map();
  for (const [type, list] of byType) {
    if (!list.length || !standinLooks[type]?.length) continue;
    const geometry = standinShapes[type].clone(), groundY = new Float32Array(list.length * 3), swap = new Float32Array(list.length);
    const mesh = new THREE.InstancedMesh(geometry, standinMaterial, list.length);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    list.forEach((i, k) => {
      const p = { type, x: props.x[i], z: props.z[i], variant: props.variant?.[i] }, look = standinLooks[type][nature.variantFor(p)], size = props.size[i];
      pointVec.set(props.x[i] - tile.position.x, look.min.y * size, props.z[i] - tile.position.z); quaternion.setFromAxisAngle(upAxis, props.turn[i]);
      scaleVec.copy(look.size).multiplyScalar(size); matrix.compose(pointVec, quaternion, scaleVec); mesh.setMatrixAt(k, matrix);
      mesh.setColorAt(k, look.color);
      groundY.set([props.fineY[i] - .08, props.coarseY[i] - .08, props.ultraY[i] - .08], k * 3); swap[k] = swapDistance(p);
      ids.set(props.id[i], { mesh, index: k });
      minX = Math.min(minX, pointVec.x); maxX = Math.max(maxX, pointVec.x); minZ = Math.min(minZ, pointVec.z); maxZ = Math.max(maxZ, pointVec.z);
      minY = Math.min(minY, props.fineY[i], props.coarseY[i], props.ultraY[i]); maxY = Math.max(maxY, props.fineY[i], props.coarseY[i], props.ultraY[i] + scaleVec.y);
    });
    geometry.setAttribute('groundY', new THREE.InstancedBufferAttribute(groundY, 3));
    geometry.setAttribute('swapAt', new THREE.InstancedBufferAttribute(swap, 1));
    // Bounds include the terrain heights the shader adds, so off-screen tiles are culled.
    const box = new THREE.Box3(new THREE.Vector3(minX - 30, minY - 5, minZ - 30), new THREE.Vector3(maxX + 30, maxY + 40, maxZ + 30));
    mesh.boundingSphere = box.getBoundingSphere(new THREE.Sphere()); mesh.boundingBox = box;
    mesh.visible = impostorsEnabled; mesh.name = `Distant ${type}s`;
    tile.add(mesh); meshes.push(mesh);
  }
  const entry = tile.userData.impostors ??= { meshes: [], ids: new Map() };
  entry.meshes.push(...meshes); for (const [id, ref] of ids) entry.ids.set(id, ref);
}
// Ramps, cabins and lookouts: one merged stand-in mesh per far tile (see
// scenery.mjs), drawn beyond each landmark's swap distance and resting on
// whichever terrain tier is drawn there.
const landmarkStandinMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85 });
landmarkStandinMaterial.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, streamUniforms);
  shader.vertexShader = 'attribute vec2 groundDeltas; attribute vec2 swapCenter; attribute float swapAt; uniform vec2 uStreamCenter;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
    vec4 world = modelMatrix * vec4(transformed, 1.0);
    float here = distance(world.xz, uStreamCenter), d = distance(swapCenter, uStreamCenter);
    world.y += mix(groundDeltas.x * smoothstep(220.0, 360.0, here), groundDeltas.y, smoothstep(${ULTRA_BLEND_START.toFixed(1)}, ${ULTRA_BLEND_END.toFixed(1)}, here));
    vec4 mvPosition = viewMatrix * world;
    gl_Position = d > swapAt ? projectionMatrix * mvPosition : vec4(2.0, 2.0, 2.0, 1.0);`);
};
landmarkStandinMaterial.customProgramCacheKey = () => 'landmark-standin-v1';
const landmarkQueue = [];
// Built one landmark per frame (each takes about a millisecond); a tile's
// pieces are merged into its single mesh once all of them are done.
function stepLandmarkStandin(tile) {
  const job = tile.userData.landmarkJob ??= (() => {
    const x0 = tile.position.x, z0 = tile.position.z;
    return { features: world.featuresNear(x0 + FAR_SIZE / 2, z0 + FAR_SIZE / 2, FAR_SIZE * .75).filter(f => f.x >= x0 && f.x < x0 + FAR_SIZE && f.z >= z0 && f.z < z0 + FAR_SIZE), parts: [] };
  })();
  const feature = job.features.shift();
  if (feature) { const part = buildLandmarkStandins([feature], world, terrain, tile.position); if (part) job.parts.push(part); }
  if (job.features.length) return false;
  delete tile.userData.landmarkJob;
  if (!job.parts.length) return true;
  const geometry = mergeStandinParts(job.parts);
  const mesh = new THREE.Mesh(geometry, landmarkStandinMaterial); mesh.name = 'Distant landmarks'; mesh.visible = impostorsEnabled;
  tile.add(mesh);
  (tile.userData.impostors ??= { meshes: [], ids: new Map() }).meshes.push(mesh);
  return true;
}
function mergeStandinParts(parts) {
  if (parts.length === 1) return parts[0];
  const merged = new THREE.BufferGeometry();
  for (const name of Object.keys(parts[0].attributes)) {
    const size = parts[0].getAttribute(name).itemSize, total = parts.reduce((n, g) => n + g.getAttribute(name).array.length, 0), array = new Float32Array(total);
    let at = 0; for (const g of parts) { array.set(g.getAttribute(name).array, at); at += g.getAttribute(name).array.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  for (const g of parts) g.dispose();
  merged.computeBoundingSphere(); merged.boundingSphere.radius += 40;
  return merged;
}
// Stand-ins for tiles that arrived before the models had loaded.
function buildPendingStandins() {
  for (const tile of farTiles.values()) if (tile.userData.pendingStandins) { const props = tile.userData.pendingStandins; delete tile.userData.pendingStandins; buildImpostors(tile, props); }
}
function disposeTile(tile) {
  scene.remove(tile); tile.geometry.dispose(); disposeSurface(tile.material);
  if (tile.userData.river) { scene.remove(tile.userData.river); tile.userData.river.geometry.dispose(); }
  for (const mesh of tile.userData.impostors?.meshes ?? []) { mesh.geometry.dispose(); if (mesh.isInstancedMesh) mesh.dispose(); } // landmark stand-ins are plain meshes
}
function refreshUltraTile(tile) {
  const { cx: tx, cz: tz } = tile.userData, hasFar = (fx, fz) => farTiles.has(`${fx},${fz}`);
  const coverage = ultraCoverage(tx, tz, hasFar);
  if (tile.userData.coverage === coverage) return;
  tile.geometry.setIndex(ultraIndices(tx, tz, hasFar, tile.userData.split));
  tile.userData.coverage = coverage;
}
function refreshFarTile(tx, tz) {
  const tile = farTiles.get(`${tx},${tz}`);
  if (!tile) return;
  const hasFine = (cx, cz) => chunks.get(`${cx},${cz}`)?.group.visible;
  const coverage = farCoverage(tx, tz, hasFine);
  if (tile.userData.coverage === coverage) return;
  tile.geometry.setIndex(farIndices(tx, tz, hasFine, tile.userData.split));
  tile.userData.coverage = coverage;
}
function desired(job) {
  if (job.kind === 'water') return waterSystem.wants(job.lake.id);
  if (job.kind === 'distant-water') return true;
  const cx = Math.floor(vehicle.x / CHUNK), cz = Math.floor(vehicle.z / CHUNK);
  if (job.kind === 'ultra') return Math.max(Math.abs(job.cx - Math.floor(vehicle.x / ULTRA_SIZE)), Math.abs(job.cz - Math.floor(vehicle.z / ULTRA_SIZE))) <= ULTRA_VIEW;
  return job.kind === 'near' ? Math.max(Math.abs(job.cx - cx), Math.abs(job.cz - cz)) <= view + 1
    : Math.max(Math.abs(job.cx - Math.floor(vehicle.x / FAR_SIZE)), Math.abs(job.cz - Math.floor(vehicle.z / FAR_SIZE))) <= FAR_VIEW;
}
function streamWorld(force = false) {
  const cx = Math.floor(vehicle.x / CHUNK), cz = Math.floor(vehicle.z / CHUNK);
  if (!force && cx === lastCX && cz === lastCZ) return;
  const syncStarted = performance.now();
  lastCX = cx; lastCZ = cz;
  const waterJobs = profiler.measure('waterSync', () => waterSystem.sync(world, vehicle.x, vehicle.z));
  const fx = Math.floor(vehicle.x / FAR_SIZE), fz = Math.floor(vehicle.z / FAR_SIZE);
  for (const [key, chunk] of chunks) {
    const ring = Math.max(Math.abs(chunk.cx - cx), Math.abs(chunk.cz - cz));
    chunk.group.visible = ring <= view; if (chunk.riverMesh) chunk.riverMesh.visible = chunk.group.visible;
    if (ring > view + 1) { disposeChunk(chunk); chunks.delete(key); }
  }
  for (const [key, tile] of farTiles) {
    if (Math.max(Math.abs(tile.userData.cx - fx), Math.abs(tile.userData.cz - fz)) > FAR_VIEW) {
      disposeTile(tile); farTiles.delete(key);
    } else refreshFarTile(tile.userData.cx, tile.userData.cz);
  }
  const ux = Math.floor(vehicle.x / ULTRA_SIZE), uz = Math.floor(vehicle.z / ULTRA_SIZE);
  for (const [key, tile] of ultraTiles) {
    if (Math.max(Math.abs(tile.userData.cx - ux), Math.abs(tile.userData.cz - uz)) > ULTRA_VIEW) { disposeTile(tile); ultraTiles.delete(key); }
    else refreshUltraTile(tile);
  }
  const existing = new Set([...pending.values()].map(job => job.kind === 'water' ? `water:${job.lake.id}` : `${job.kind}:${job.cx},${job.cz}`));
  const queuedDistant = jobs.find(job => job.kind === 'distant-water');
  jobs = queuedDistant ? [queuedDistant] : [];
  function enqueue(kind, x, z, priority) {
    if ({ near: chunks, far: farTiles, ultra: ultraTiles }[kind].has(`${x},${z}`) || existing.has(`${kind}:${x},${z}`)) return;
    jobs.push({ kind, cx: x, cz: z, seed, generation, id: ++jobId, priority });
  }
  // Tiles ahead of a fast car or plane load first, in every tier.
  const speed = Math.hypot(vehicle.vx, vehicle.vz), ahead = (dx, dz) => speed > 1 && (dx || dz) ? (dx * vehicle.vx + dz * vehicle.vz) / (Math.hypot(dx, dz) * speed) * Math.min(speed / 40, 1) : 0;
  for (let dx = -view - 1; dx <= view + 1; dx++) for (let dz = -view - 1; dz <= view + 1; dz++) {
    const ring = Math.max(Math.abs(dx), Math.abs(dz));
    enqueue('near', cx + dx, cz + dz, (ring > view ? 100 : 0) + Math.hypot(dx, dz) - ahead(dx, dz) * 1.5);
  }
  // Far and horizon tiles interleave with near chunks instead of waiting for
  // all of them: at flying speed new near chunks never stop arriving.
  for (let dx = -FAR_VIEW; dx <= FAR_VIEW; dx++) for (let dz = -FAR_VIEW; dz <= FAR_VIEW; dz++) enqueue('far', fx + dx, fz + dz, 1 + Math.hypot(dx, dz) * 1.5 - ahead(dx, dz) * 1.5);
  for (let dx = -ULTRA_VIEW; dx <= ULTRA_VIEW; dx++) for (let dz = -ULTRA_VIEW; dz <= ULTRA_VIEW; dz++) enqueue('ultra', ux + dx, uz + dz, .5 + Math.hypot(dx, dz) - ahead(dx, dz));
  for (const lake of waterJobs) if (!existing.has(`water:${lake.id}`)) {
    jobs.push({ kind: 'water', lake, seed, generation, id: ++jobId,
      priority: 2 + Math.max(0, Math.hypot(lake.x - vehicle.x, lake.z - vehicle.z) - Math.max(lake.rx, lake.rz)) / CHUNK });
  }
  if (!queuedDistant && Math.hypot(vehicle.x - distantAt.x, vehicle.z - distantAt.z) > 500 && ![...pending.values()].some(job => job.kind === 'distant-water')) {
    distantAt = { x: vehicle.x, z: vehicle.z };
    jobs.push({ kind: 'distant-water', x: vehicle.x, z: vehicle.z, seed, generation, id: ++jobId, priority: 3 });
  }
  jobs.sort((a, b) => a.priority - b.priority);
  profiler.record('streamSync', performance.now() - syncStarted);
}
function worldReady() {
  for (let dx = -view; dx <= view; dx++) for (let dz = -view; dz <= view; dz++) if (!chunks.has(`${lastCX + dx},${lastCZ + dz}`)) return false;
  return farTiles.size === (FAR_VIEW * 2 + 1) ** 2 && ultraTiles.size === (ULTRA_VIEW * 2 + 1) ** 2 && waterSystem.ready && distantReady;
}
function drivable() {
  // Flight never touches chunk geometry: the surface is procedural. Pausing a
  // plane mid-air while scenery streams would only look like a hitch.
  if (vehicle.flying) return true;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (!chunks.has(`${lastCX + dx},${lastCZ + dz}`)) return false;
  return true;
}
function processStreaming() {
  if (!workers.length || streamError || natureError) return;
  const budgetStart = performance.now();
  // Worker messages are installed within a frame budget, rather than all at
  // once. At most two jobs per worker are in flight, keeping memory and upload work bounded.
  while (nature && completed.length && performance.now() - budgetStart < 4) {
    const job = completed.shift(); pending.delete(job.id);
    if (job.generation !== generation || !desired(job)) continue;
    if (job.kind === 'water') {
      profiler.measure('waterInstall', () => waterSystem.install(job.lake, job.water));
    } else if (job.kind === 'distant-water') {
      profiler.measure('distantWaterInstall', () => waterSystem.installDistant(job.water, job.ranges)); distantReady = true;
    } else if (job.kind === 'near') {
      buildChunk(job);
      { const chunk = chunks.get(`${job.cx},${job.cz}`); chunk.group.visible = Math.max(Math.abs(job.cx - lastCX), Math.abs(job.cz - lastCZ)) <= view; if (chunk.riverMesh) chunk.riverMesh.visible = chunk.group.visible; }
      refreshFarTile(Math.floor(job.cx / 4), Math.floor(job.cz / 4));
    } else if (job.kind === 'ultra') {
      const tile = new THREE.Mesh(geometryFromData(job.ground), terrainSurface(job.roadMap, ULTRA_SIZE, job.roadInfo));
      tile.position.set(job.cx * ULTRA_SIZE, 0, job.cz * ULTRA_SIZE);
      tile.userData = { cx: job.cx, cz: job.cz, split: job.ground.split };
      ultraTiles.set(`${job.cx},${job.cz}`, tile); refreshUltraTile(tile); scene.add(tile);
    } else {
      const tile = new THREE.Mesh(geometryFromData(job.ground), terrainSurface(job.roadMap, FAR_SIZE, job.roadInfo));
      tile.position.set(job.cx * FAR_SIZE, 0, job.cz * FAR_SIZE);
      tile.userData = { cx: job.cx, cz: job.cz, split: job.ground.split }; tile.receiveShadow = true;
      if (job.river) { tile.userData.river = waterSystem.riverMesh(job.river); scene.add(tile.userData.river); }
      farTiles.set(`${job.cx},${job.cz}`, tile); refreshFarTile(job.cx, job.cz); scene.add(tile);
      profiler.measure('propStandins', () => buildImpostors(tile, job.trees));
      landmarkQueue.push(tile); // built in a later frame with time to spare
      const parent = ultraTiles.get(`${Math.floor(job.cx / 4)},${Math.floor(job.cz / 4)}`); if (parent) refreshUltraTile(parent);
    }
  }
  // Landmark stand-ins for newly arrived far tiles: one landmark per frame, and
  // only when this frame's installs left time, so they never cause a hitch.
  while (landmarkQueue.length && performance.now() - budgetStart < 1.5) {
    const tile = landmarkQueue[0];
    if (farTiles.get(`${tile.userData.cx},${tile.userData.cz}`) !== tile) { landmarkQueue.shift(); continue; } // already unloaded
    if (profiler.measure('landmarkStandins', () => stepLandmarkStandin(tile))) landmarkQueue.shift();
    break;
  }
  profiler.record('streamInstall', performance.now() - budgetStart);
  const busy = [0, 0];
  for (const job of pending.values()) busy[laneOf(job)]++;
  for (let i = 0; i < jobs.length && (busy[0] < LANE_JOBS || busy[1] < LANE_JOBS);) {
    const job = jobs[i], lane = laneOf(job);
    if (!desired(job)) { jobs.splice(i, 1); continue; }
    if (busy[lane] >= LANE_JOBS) { i++; continue; }
    jobs.splice(i, 1); busy[lane]++; pending.set(job.id, job); workers[lane].postMessage(job);
  }
  if (loading) {
    const total = (view * 2 + 1) ** 2 + (FAR_VIEW * 2 + 1) ** 2 + (ULTRA_VIEW * 2 + 1) ** 2;
    const count = [...chunks.values()].filter(chunk => chunk.group.visible).length + farTiles.size + ultraTiles.size;
    $('startBtn').firstElementChild.textContent = carError ? 'Unable to load the car' : !nature ? 'Preparing scenery' : worldReady() && !carReady ? 'Preparing your car' : `Preparing the world · ${Math.min(99, Math.floor(count / total * 100))}%`;
    // (and the roads around the start are worked out, so none is built mid-drive)
    if (worldReady() && carReady && roadsReady) {
      loading = false; $('startBtn').disabled = false; $('startBtn').firstElementChild.textContent = started ? 'Keep exploring' : 'Start exploring';
      resetTiming(); resetCamera(); updateHUD(); drawMap();
      precompileShaders();
      profiler.record('worldLoad', performance.now() - loadingStarted);
      document.dispatchEvent(new Event('worldready'));
      if (resumeAfterLoad) resume();
      resumeAfterLoad = false;
    }
  }
}
// Build every shader while the loading screen is up, including objects not
// drawn yet (debris before the first crash, the car's ground shadow when you
// start in the air, grass when none is in view): three.js otherwise builds a
// shader the first time it is drawn, stalling that frame for 10–50 ms.
// Rivers and bridges are often out of sight at the start: their shaders are
// built at load with everything else.
const bridgeWarmup = new THREE.Mesh(new THREE.BufferGeometry(), bridgeMaterial);
bridgeWarmup.castShadow = bridgeWarmup.receiveShadow = true;
const roadsideWarmup = new THREE.Mesh(new THREE.BufferGeometry(), roadsideMaterial);
roadsideWarmup.castShadow = true;
function precompileShaders() {
  softenScenery(roadsideMaterial, 'fade');
  renderer.compile(scene, camera);
  for (const warmup of [grass.warmup, waterSystem.riverWarmup, bridgeWarmup, roadsideWarmup]) renderer.compile(warmup, camera, scene);
  motionBlur.compile();
}
function beginWorldLoad(continueDriving = false) {
  if (running) pause();
  for (const worker of workers) worker.terminate();
  generation++; pending.clear(); completed = []; jobs = []; landmarkQueue.length = 0;
  loading = true; resumeAfterLoad = continueDriving; running = false; streamError = null; loadingStarted = performance.now(); roadsReady = false;
  $('startBtn').disabled = true; resetTiming();
  for (const chunk of chunks.values()) disposeChunk(chunk); chunks.clear();
  for (const tile of farTiles.values()) disposeTile(tile); farTiles.clear();
  for (const tile of ultraTiles.values()) disposeTile(tile); ultraTiles.clear();
  terrain = createTerrain(world);
  waterSystem.clear(); distantAt = { x: Infinity, z: Infinity }; distantReady = false;
  workers = [0, 1].map(() => new Worker(new URL('./world-worker.mjs?v=classes-2', import.meta.url), { type: 'module' }));
  const failed = message => { streamError = message; running = false; $('loadError').hidden = false; $('startBtn').firstElementChild.textContent = 'Unable to prepare the world'; };
  const received = ({ data }) => {
    if (data.generation !== generation) return;
    if (data.error) { failed(data.error); return; }
    profiler.record(data.kind === 'water' ? 'workerWater' : 'workerBuild', data.workMs); completed.push(data);
    // While the world loads there is no drive to keep smooth: install each
    // result as it arrives and hand the workers their next jobs, rather than once
    // per frame. Where frames are slow (software rendering, an old phone),
    // that keeps the workers busy instead of waiting on the screen. As in
    // frame(), the world is drawn once the moment it is ready.
    if (loading) { processStreaming(); if (!loading) render(0); }
  };
  for (const worker of workers) { worker.onerror = error => failed(error.message); worker.onmessage = received; }
  lastCX = lastCZ = Infinity; streamWorld(true);
}
function nearbyObstacles() {
  const cx = Math.floor(vehicle.x / CHUNK), cz = Math.floor(vehicle.z / CHUNK), result = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const chunk = chunks.get(`${cx + dx},${cz + dz}`); if (chunk) result.push(...chunk.props, ...chunk.barriers); }
  return result;
}

// The editable Blender model is exported as a locally bundled, animated glTF rig.
const car = new THREE.Group(); scene.add(car); car.rotation.order = 'YXZ';
let body = new THREE.Group(), wheelPivots = [], wheelSpinners = [];
let headMat = material('#f9efce'), brakeMat = material('#af3c25');
let carReady = false, carError = null, carTriangles = 0, carBatching = [];
let transformation = null, flightRig = null, propeller = null, propellerAngle = 0;
loadVehicleModel(renderer).then(asset => {
  car.add(asset.model);
  ({ body, wheelPivots, wheelSpinners, headMat, brakeMat, transformation, propeller } = asset); flightRig = asset.flight;
  carTriangles = asset.triangles; carBatching = asset.batching; carReady = true;
}).catch(error => {
  carError = error.message;
  $('loadError').hidden = false;
  $('startBtn').firstElementChild.textContent = 'Unable to load the car';
  console.error('Vehicle model failed to load:', error);
});
const headlight = new THREE.SpotLight('#ffe4b1', 0, 60, .5, .5, 1.2); headlight.position.set(0, 1.5, 2);
const lightTarget = new THREE.Object3D(); lightTarget.position.set(0, 0, 25); car.add(headlight, lightTarget); headlight.target = lightTarget;
const headlightAt = new THREE.Vector3(), headlightAim = new THREE.Vector3();
// Headlights come on by themselves at dusk and go off after sunrise, until you
// choose with L for the rest of the visit.
function setHeadlights(on) { headlight.intensity = on ? 75 : 0; headMat.emissiveIntensity = on ? 2 : .45; }
// Soft contact shadow makes the height of jumps easy to judge.
const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
const shadowContext = shadowCanvas.getContext('2d'), shadowGradient = shadowContext.createRadialGradient(32, 32, 2, 32, 32, 32);
shadowGradient.addColorStop(0, 'rgba(20,27,20,.36)'); shadowGradient.addColorStop(1, 'rgba(20,27,20,0)');
shadowContext.fillStyle = shadowGradient; shadowContext.fillRect(0, 0, 64, 64);
const contact = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
contact.rotation.x = -Math.PI / 2; scene.add(contact);

// Left/right placement of a world point as heard from the camera.
const cameraRight = new THREE.Vector3(), shadowAhead = new THREE.Vector3(), farAhead = new THREE.Vector3();
function panAt(x, z) {
  cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
  const dx = x - camera.position.x, dz = z - camera.position.z;
  return Math.max(-1, Math.min(1, (dx * cameraRight.x + dz * cameraRight.z) / Math.max(4, Math.hypot(dx, dz)))) * .8;
}
const heard = { impact: 0, wingStrikes: 0, wingCrashes: 0, landings: vehicle.landings, surface: 'road', surfaceCheck: 0, contact: -10 };
function updateSound(throttle, splashes, dt) {
  const v = vehicle;
  if ((heard.surfaceCheck -= dt) <= 0) {
    heard.surfaceCheck = .25;
    heard.surface = v.onDirt ? 'dirt' : v.onRoad ? 'road' : world.desertAt(v.x, v.z) || world.waterAt(v.x, v.z) || world.lakesNear(v.x, v.z, 0).length ? 'sand' : 'dirt';
  }
  const slip = Math.abs(v.vx * Math.cos(v.heading) - v.vz * Math.sin(v.heading));
  audio.vehicle.update({ speed: v.speed, throttle, grounded: v.grounded, floating: v.floating, flying: v.flying, airspeed: v.airspeed, transform: v.transform, flight: v.flight, slip, surface: heard.surface, waterDepth: v.waterDepth, rain: weather.rain, snow: weather.snow }, dt);
  // Events: a fresh rise in impact is a landing, bounce or knock; splashes come
  // from the water; the flight model counts wing strikes and scrapes.
  const decayed = heard.impact * Math.exp(-8 * dt);
  // A thump needs a quiet gap since the last contact. Skimming the ground in
  // flight, or a fast car hopping over rough ground, touches many times a
  // second: each touch restarts the gap, so a run of contacts thumps once, on
  // the first, and again only after a real time in the air. A car landing
  // makes no thump at all; only knocks against walls and props do.
  const t = audio.context.currentTime, landed = v.landings !== heard.landings;
  if (v.impact > decayed + .03 && !v.floating && !splashes.length) {
    const quiet = t - heard.contact; heard.contact = t;
    const worth = v.flightMode ? v.impact > .1 && quiet > 1.2 : !landed && v.impact > .1 && quiet > .5;
    if (worth) audio.vehicle.thump(v.impact);
  }
  heard.impact = v.impact; heard.landings = v.landings;
  for (const splash of splashes) audio.vehicle.splash(splash.power, panAt(splash.x, splash.z));
  if ((v.wingStrikes || 0) > heard.wingStrikes && v.lastStrike) audio.vehicle.strike(v.lastStrike.heavy, panAt(v.lastStrike.x, v.lastStrike.z));
  if ((v.wingCrashes || 0) > heard.wingCrashes) audio.vehicle.scrape(.8);
  heard.wingStrikes = v.wingStrikes || 0; heard.wingCrashes = v.wingCrashes || 0;
}
let audio = null;
function initAudio() {
  if (audio) { audio.context.resume(); return; }
  try {
    const context = new AudioContext(), master = context.createGain(), limiter = context.createDynamicsCompressor();
    master.gain.value = muted ? 0 : 1;
    limiter.threshold.value = -10; limiter.knee.value = 12; limiter.ratio.value = 4;
    master.connect(limiter).connect(context.destination);
    const sounds = createVehicleAudio(context, master);
    audio = { context, master, vehicle: sounds, breaks: createBreakAudio(context, master, 8, sounds.echo) };
  } catch {}
}
function syncSound() {
  $('soundBtn').innerHTML = `<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>${muted ? '<path d="m16 9 5 6m0-6-5 6"/>' : '<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}</svg>`;
  $('soundBtn').setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}
function toggleSound() {
  muted = !muted; if (!muted) initAudio();
  if (audio) { audio.master.gain.cancelScheduledValues(audio.context.currentTime); audio.master.gain.setValueAtTime(muted ? 0 : 1, audio.context.currentTime); }
  try { localStorage.setItem('endless-drive-muted', muted ? '1' : '0'); } catch {} syncSound();
}
$('soundBtn').onclick = toggleSound;
function saveRecord() { bestDistance = Math.max(bestDistance, vehicle.distance); if (!testMode) try { localStorage.setItem('endless-drive-records', JSON.stringify({ distance: bestDistance })); } catch {} }
let toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600); }
function clearInput() { releaseSlider(false); releaseRing(false); keyStates.clear(); touchStates.clear(); for (const k in input) input[k] = false; document.querySelectorAll('[data-control]').forEach(el => el.classList.remove('active')); }
function syncInput() {
  for (const k of ['up', 'down', 'left', 'right', 'jump', 'brake']) input[k] = [...keyStates].some(code => keyMap[code] === k) || [...touchStates.values()].includes(k);
  const touches = [...touchStates.values()];
  for (const [axis, codes] of Object.entries(flightKeys)) input[axis] = codes.some(code => keyStates.has(code)) || touches.includes(flightTouch[axis]);
  input.simpleFlight = simpleFlight;
  // Analog axes add to the digital keys; physics clamps the combined value.
  // In the air the ring steers (x) and pitches (y, up climbs); otherwise the slider steers.
  // With tilt steering on, the phone's turn steers (and rolls) and its tilt
  // pitches, unless a finger is on the slider or ring.
  const tilted = tiltActive() ? tiltAxes(tilt.reading, tilt.neutral) : null;
  input.steer = ring.pointer !== null ? steerAxis(ring.x, settings.sensitivity) : slider.pointer !== null ? steerAxis(slider.value, settings.sensitivity) : tilted ? steerAxis(tilted.wheel, settings.sensitivity) : undefined;
  input.pitchAxis = ring.pointer !== null ? steerAxis(ring.y, settings.sensitivity) : tilted && vehicle.flightMode ? steerAxis(tilted.pitch, settings.sensitivity) : undefined;
}
const throttleInput = () => controlAxis(input.throttle, input.up, input.down);
function resume() {
  if ($('startBtn').disabled || upright()) return;
  running = true; started = true; resetTiming(); auto?.reset(performance.now());
  if (settings.tilt) { requestTilt(); tilt.neutral = null; } // re-centre the climb/dive tilt
  $('menu').classList.add('closed'); $('menu').inert = true; $('menu').setAttribute('aria-hidden', 'true');
  $('pauseBtn').hidden = false; document.body.classList.add('driving'); renderer.domElement.focus({ preventScroll: true });
  if (!muted) initAudio();
}
function pause() {
  if (!running) return;
  running = false; clearInput(); saveRecord(); document.body.classList.remove('driving');
  if (audio) audio.context.suspend();
  $('menu').classList.remove('closed'); $('menu').inert = false; $('menu').removeAttribute('aria-hidden'); $('pauseBtn').hidden = true;
  $('menuTitle').innerHTML = 'Room to<br><em>breathe.</em>'; $('menuCopy').innerHTML = 'Your road will still be here.<br>Pick up where you left off.';
  $('startBtn').firstElementChild.textContent = 'Keep exploring'; $('menuStats').hidden = false;
  $('pauseTools').hidden = false;
  $('runDistance').textContent = (vehicle.distance / 1000).toFixed(2); $('bestDistance').textContent = (bestDistance / 1000).toFixed(2);
  $('startBtn').focus({ preventScroll: true });
}
function resetTiming() {
  motionBlur.reset();
  accumulator = 0; previousTime = performance.now(); frame.lastNow = previousTime;
  uiTime = mapTime = 0;
  vehiclePresentation.reset(vehicle);
  updateDesiredCamera();
  previousDesiredCamera.copy(desiredCamera); previousLook.copy(look);
  previousTargetFov = camera.fov;
}
// Keep the chase camera above the ground and in sight of the car. On steep
// ground a hillside can rise between them: the camera first moves in along
// its line to the car (keeping the same view angle), and only if that is not
// enough rises until its line of sight clears the terrain by a metre.
const sightPoint = new THREE.Vector3();
function sightBlocked(x, y, z, camX, camY, camZ) {
  let lift = 0;
  for (let i = 1; i < 8; i++) {
    const f = i / 8, py = y + (camY - y) * f;
    lift = Math.max(lift, (world.surface(x + (camX - x) * f, z + (camZ - z) * f) + 1 - py) / f);
  }
  return lift;
}
function keepCameraInView(x, y, z) {
  cameraPosition.y = Math.max(cameraPosition.y, world.surface(cameraPosition.x, cameraPosition.z) + 1.8);
  if (cameraMode === 2 && running) return; // the cockpit view sits in the car
  if (!sightBlocked(x, y, z, cameraPosition.x, cameraPosition.y, cameraPosition.z)) return;
  for (const k of [.85, .7, .55]) {
    sightPoint.set(x, y, z).lerp(cameraPosition, k);
    const lift = sightBlocked(x, y, z, sightPoint.x, sightPoint.y, sightPoint.z);
    if (!lift || k === .55) { cameraPosition.copy(sightPoint); cameraPosition.y += lift; return; }
  }
}
function resetCamera() {
  motionBlur.reset();
  updateDesiredCamera();
  cameraPosition.copy(desiredCamera); cameraTarget.copy(look);
  previousDesiredCamera.copy(desiredCamera); previousLook.copy(look);
  keepCameraInView(vehicle.x, vehicle.y + 1.2, vehicle.z);
  camera.position.copy(cameraPosition); camera.lookAt(cameraTarget);
}
function newWorld() {
  const continueDriving = running || resumeAfterLoad && loading;
  saveRecord(); clearInput(); seed = freshSeed(); world = createWorld(seed); vehicle = createVehicle(world, 0, 0, world.startHeading);
  debris.clear(); treeBreakage?.clear(); audio?.breaks.clear(); audio?.vehicle.clear();
  const url = new URL(location.href); url.searchParams.set('seed', seed); history.replaceState(null, '', url);
  beginWorldLoad(continueDriving); resetCamera(); syncSeed(); updateHUD(); drawMap();
  reportedLanding = 0; reportedBoat = false; reportedFlying = false; clouds.reset(seed); weather.clock = 0; weather.clouds = .38; if (!fixedTime) clock.hours = worldHour(seed); weather.check = 0; weather.rain = weather.snow = 0; $('runDistance').textContent = '0.00'; toast('A new road ahead. World ' + seed);
}
function syncSeed() { $('seedTxt').textContent = String(seed).padStart(6, '0'); }
$('startBtn').onclick = resume; $('pauseBtn').onclick = pause; $('newWorld').onclick = newWorld;
function recover() {
  if (profiler.measure('recovery', () => recoverVehicle(vehicle, world))) { reportedFlying = vehicle.flying; streamWorld(); resetTiming(); resetCamera(); updateHUD(); toast('Back on your wheels.'); }
}
function toggleFly() {
  const on = toggleFlight(vehicle);
  toast(on ? vehicle.grounded || vehicle.floating ? `Wings out — lift off at ${Math.round(TAKEOFF_SPEED * 3.6)} km/h` : 'Wings out — glide!'
    : vehicle.flying ? 'Folding wings — touch down anywhere' : 'Wings stowed');
  updateHUD();
}
$('flyBtn').addEventListener('pointerdown', e => { e.preventDefault(); if (running) toggleFly(); });
// 1–4 (or Time of day in the menu) jump to sunrise, noon, sunset or night;
// the clock carries on from there.
const TIME_PRESETS = [['Sunrise', 6.2], ['Noon', 12], ['Sunset', 17.8], ['Night', 22]];
let timePreset = -1;
function setTimeOfDay(index) {
  timePreset = index; const [name, hours] = TIME_PRESETS[index];
  clock.hours = hours; weather.check = 0;
  $('timeBtn').textContent = `Time of day: ${name}`;
  toast(`${name} · ${clockLabel(hours)}`);
}
$('timeBtn').onclick = () => setTimeOfDay((timePreset + 1) % TIME_PRESETS.length);
// T switches between full three-axis flight and the simple arcade controls
// (bank to turn, climb/dive, levels itself when released) for this visit.
function toggleFlightControls() {
  simpleFlight = !simpleFlight; syncInput();
  toast(simpleFlight ? coarse ? 'Simple flight · ring: sideways turns, up climbs, down dives · ↑↓ throttle' : 'Simple flight · A/D turn · Space/Shift climb and dive · W/S throttle'
    : coarse ? 'Full flight · ring: sideways rolls, up climbs, down dives · ↑↓ throttle' : 'Full flight · ↑/↓ pitch · A/D roll · Q/E yaw · W/S throttle');
  updateHUD();
}
$('simpleBtn').addEventListener('pointerdown', e => { e.preventDefault(); if (running) toggleFlightControls(); });
function cycleCamera() {
  cameraMode = (cameraMode + 1) % 3; resetCamera();
  $('cameraBtn').textContent = 'Camera: ' + ['Chase', 'Wide', 'Bonnet'][cameraMode];
  toast(['Chase camera', 'Wide camera', 'Bonnet camera'][cameraMode]);
}
$('recoverBtn').onclick = () => { recover(); resume(); };
$('cameraBtn').onclick = cycleCamera;
document.querySelector('.brand').onclick = e => { e.preventDefault(); if (running) pause(); };
$('copySeed').onclick = async () => {
  const url = new URL(location.href); url.searchParams.set('seed', seed);
  try { await navigator.clipboard.writeText(url.href); toast('World link copied. Bring a friend.'); } catch { history.replaceState(null, '', url); toast('Your world link is in the address bar.'); }
};
addEventListener('keydown', e => {
  if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); if (!e.repeat && started) running ? pause() : resume(); return; }
  if (keyMap[e.code]) {
    if (running) {
      e.preventDefault();
      // Queue the edge at event time: a quick tap can begin AND end between
      // physics ticks, especially on a slower display or while streaming.
      if (e.code === 'Space' && !e.repeat) vehicle.jumpBuffer = .16;
      keyStates.add(e.code); syncInput();
    }
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyM') toggleSound();
  if (!running) return;
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyR') recover();
  if (e.code === 'KeyF') toggleFly();
  if (e.code === 'KeyT') toggleFlightControls();
  const preset = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[e.code];
  if (preset !== undefined) setTimeOfDay(preset);
  if (e.code === 'KeyN') newWorld();
  if (e.code === 'KeyL') { lightsOn = !lightsOn; lightsChosen = true; setHeadlights(lightsOn); toast(lightsOn ? 'Headlights on' : 'Headlights off'); }
});
addEventListener('keyup', e => { keyStates.delete(e.code); syncInput(); });
addEventListener('blur', () => { clearInput(); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('beforeunload', saveRecord);
for (const el of document.querySelectorAll('[data-control]')) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); if (!running) return; el.setPointerCapture(e.pointerId); if (el.dataset.control === 'jump') vehicle.jumpBuffer = .16; touchStates.set(e.pointerId, el.dataset.control); el.classList.add('active'); syncInput(); });
  const release = e => { touchStates.delete(e.pointerId); el.classList.remove('active'); syncInput(); };
  el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); el.addEventListener('lostpointercapture', release);
}
// Keep keyboard focus within the visible menu without trapping gameplay controls.
$('menu').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const buttons = [...$('menu').querySelectorAll('button:not([disabled])')].filter(b => b.offsetParent !== null);
  const first = buttons[0], last = buttons.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function applyQuality(index) {
  qualityLevel = index;
  const level = levels[index];
  renderer.setPixelRatio(Math.min(devicePixelRatio, level.pixelRatio));
  if (sun.shadow.mapSize.x !== level.shadow) {
    sun.shadow.mapSize.setScalar(level.shadow);
    // Three.js only allocates the shadow target once; release it to resize.
    sun.shadow.map?.dispose(); sun.shadow.map = null;
  }
  setFarShadow(level.farShadow);
  grass.setQuality(level.grass);
  // Distant stand-ins are skipped on Low (real props fade out instead).
  impostorsEnabled = index > 0; standinUniform.value = impostorsEnabled ? 1 : 0;
  weatherFx.setDensity([.35, .6, .8, 1][index]);
  for (const tile of farTiles.values()) for (const mesh of tile.userData.impostors?.meshes ?? []) mesh.visible = impostorsEnabled;
  // Low draws one wave layer with no reflected clouds, sparkle or caustics.
  waterSystem.setDetail(index > 0);
  syncSettings();
}
const qualityNames = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' };
function syncSettings() {
  const level = levels[qualityLevel].name;
  $('qualityBtn').textContent = `Graphics: ${qualityNames[settings.quality]}${auto ? ` · ${level === 'medium+' ? 'Medium+' : qualityNames[level]}` : ''}`;
  $('sensitivity').value = Math.round(settings.sensitivity * 100);
  $('sensitivityValue').textContent = `${Math.round(settings.sensitivity * 100)}%`;
  $('tiltBtn').textContent = `Tilt: ${settings.tilt ? 'On' : 'Off'}`; $('tiltBtn').setAttribute('aria-pressed', String(settings.tilt));
  document.body.classList.toggle('tilt', settings.tilt);
  $('touchGuide').textContent = settings.tilt ? 'Turn the phone like a steering wheel to steer; Jump and Drift sit at the left. ↑ accelerates, ↓ brakes or reverses, and FLY is beside them. In the air, turn to roll and tilt the top toward you to climb, away to dive; the ring works too.'
    : 'Slide the left control to steer; Jump and Drift sit just above it. ↑ accelerates, ↓ brakes or reverses, and FLY is beside them. In the air the slider becomes a ring: drag up to climb, down to dive, sideways to roll.';
  $('perfBtn').textContent = `FPS meter: ${settings.perfMeter ? 'On' : 'Off'}`; $('perfBtn').setAttribute('aria-pressed', String(Boolean(settings.perfMeter)));
  $('blurBtn').textContent = `Motion blur: ${settings.motionBlur ? 'On' : 'Off'}`; $('blurBtn').setAttribute('aria-pressed', String(settings.motionBlur));
}
$('qualityBtn').onclick = () => {
  settings.quality = QUALITY_PRESETS[(QUALITY_PRESETS.indexOf(settings.quality) + 1) % QUALITY_PRESETS.length];
  applyQuality(startQuality()); saveSettings();
  toast(settings.quality === 'auto' ? 'Auto graphics adjust to your device' : `${qualityNames[settings.quality]} graphics`);
};
$('perfBtn').onclick = () => {
  settings.perfMeter = !settings.perfMeter; perfMeter.setVisible(settings.perfMeter); saveSettings(); syncSettings();
  toast(settings.perfMeter ? 'FPS meter on' : 'FPS meter off');
};
$('blurBtn').onclick = () => {
  settings.motionBlur = !settings.motionBlur; settings.motionBlurChosen = true; saveSettings(); syncSettings();
  toast(settings.motionBlur ? 'Motion blur on' : 'Motion blur off');
};
$('sensitivity').oninput = e => { settings.sensitivity = clamp(Number(e.target.value) / 100, .5, 1.5); saveSettings(); syncSettings(); };

// Tilt steering (phones): turn the phone like a steering wheel. The reading
// comes from deviceorientation (see tilt.mjs); iPhones only send it once the
// player allows motion access, which must be asked from a tap.
const tilt = { reading: null, neutral: null, at: 0, permitted: typeof DeviceOrientationEvent === 'undefined' ? false : typeof DeviceOrientationEvent.requestPermission !== 'function' };
// Fresh readings only: a sensor that stops sending stops steering.
const tiltActive = () => settings.tilt && tilt.reading !== null && performance.now() - tilt.at < 500;
const screenAngle = () => ((screen.orientation?.angle ?? window.orientation ?? 0) % 360 + 360) % 360;
async function requestTilt() {
  if (tilt.permitted || typeof DeviceOrientationEvent === 'undefined') return tilt.permitted;
  try { tilt.permitted = await DeviceOrientationEvent.requestPermission() === 'granted'; } catch { tilt.permitted = false; }
  return tilt.permitted;
}
addEventListener('deviceorientation', e => {
  if (!settings.tilt || e.beta === null || e.gamma === null) return;
  const next = readTilt(e.beta, e.gamma, screenAngle());
  // Light smoothing takes the jitter out of cheaper sensors (about 50 ms).
  if (tilt.reading && performance.now() - tilt.at < 200) for (const k of ['wheel', 'lean', 'grip']) next[k] = tilt.reading[k] + (next[k] - tilt.reading[k]) * .4;
  tilt.reading = next; tilt.at = performance.now(); tilt.neutral ??= next.lean;
  syncInput();
});
$('tiltBtn').onclick = async () => {
  if (settings.tilt) { settings.tilt = false; tilt.reading = null; saveSettings(); syncSettings(); syncInput(); toast('Tilt steering off · slide to steer'); return; }
  if (!await requestTilt()) { toast('Tilt needs motion access · allow it in your browser settings'); return; }
  settings.tilt = true; tilt.neutral = null; saveSettings(); syncSettings();
  toast('Tilt steering on · turn the phone like a wheel');
  setTimeout(() => { if (settings.tilt && tilt.reading === null) { settings.tilt = false; saveSettings(); syncSettings(); toast('No tilt sensor found on this device'); } }, 1500);
};

// Steering slider in place of the ← → buttons. The track is fixed: the value
// is read from its center, and the knob stops at either end however far the
// finger travels.
const slider = { el: $('steerSlider'), pointer: null, value: 0 };
function releaseSlider(sync = true) {
  if (slider.pointer === null) return;
  slider.pointer = null; slider.value = 0;
  slider.el.classList.remove('active'); slider.el.querySelector('i').style.transform = ''; slider.el.setAttribute('aria-valuenow', '0');
  if (sync) syncInput();
}
function moveSlider(e) {
  const track = slider.el.getBoundingClientRect(), travel = (track.width - slider.el.querySelector('i').offsetWidth) / 2;
  slider.value = clamp((e.clientX - (track.left + track.width / 2)) / travel, -1, 1);
  slider.el.querySelector('i').style.transform = `translateX(${slider.value * travel}px)`;
  slider.el.setAttribute('aria-valuenow', String(Math.round(slider.value * 100)));
  syncInput();
}
slider.el.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (!running || slider.pointer !== null) return;
  slider.el.setPointerCapture(e.pointerId); slider.pointer = e.pointerId;
  slider.el.classList.add('active'); moveSlider(e);
});
slider.el.addEventListener('pointermove', e => { if (e.pointerId === slider.pointer) moveSlider(e); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) slider.el.addEventListener(type, e => { if (e.pointerId === slider.pointer) releaseSlider(); });
// The flight ring replaces the slider in the air. Its base is fixed: the knob
// follows the finger inside the ring and stops at its edge.
const ring = { el: $('flightRing'), pointer: null, x: 0, y: 0 };
function releaseRing(sync = true) {
  if (ring.pointer === null) return;
  ring.pointer = null; ring.x = ring.y = 0;
  ring.el.classList.remove('active'); ring.el.querySelector('i').style.transform = ''; ring.el.setAttribute('aria-valuenow', '0');
  if (sync) syncInput();
}
function moveRing(e) {
  const box = ring.el.getBoundingClientRect(), reach = (box.width - ring.el.querySelector('i').offsetWidth) / 2;
  let x = (e.clientX - (box.left + box.width / 2)) / reach, y = (e.clientY - (box.top + box.height / 2)) / reach;
  const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
  ring.x = x; ring.y = y;
  ring.el.querySelector('i').style.transform = `translate(${x * reach}px, ${y * reach}px)`;
  ring.el.setAttribute('aria-valuenow', String(Math.round(-y * 100)));
  syncInput();
}
ring.el.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (!running || ring.pointer !== null) return;
  ring.el.setPointerCapture(e.pointerId); ring.pointer = e.pointerId;
  ring.el.classList.add('active'); moveRing(e);
});
ring.el.addEventListener('pointermove', e => { if (e.pointerId === ring.pointer) moveRing(e); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) ring.el.addEventListener(type, e => { if (e.pointerId === ring.pointer) releaseRing(); });

// Phones in landscape play fullscreen. Browsers only allow it from a tap, so
// the next tap (on anything) asks for it; turning back to portrait leaves it.
// (iPhone Safari has no page fullscreen: added to the home screen, the game
// opens fullscreen instead.)
const fullscreenElement = () => document.fullscreenElement ?? document.webkitFullscreenElement;
function enterFullscreen() {
  if (!coarse || !landscape.matches || fullscreenElement() || !(document.fullscreenEnabled || document.webkitFullscreenEnabled)) return;
  const root = document.documentElement, request = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen?.();
  request?.catch?.(() => {});
}
addEventListener('pointerdown', enterFullscreen, { capture: true });
landscape.addEventListener('change', () => { if (!landscape.matches && fullscreenElement()) (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document)?.catch?.(() => {}); });
// Phones don't play upright: a notice asks to turn the phone sideways, and
// the drive pauses until it is.
function syncOrientation() {
  document.body.classList.toggle('upright', upright());
  if (upright()) pause();
}
landscape.addEventListener('change', syncOrientation); syncOrientation();

const mapContext = $('minimap').getContext('2d');
function drawMap() {
  const mapStarted = performance.now();
  // The map zooms out as the plane climbs, so the view below stays useful.
  const altitude = Math.max(0, vehicle.y - world.surface(vehicle.x, vehicle.z));
  const ctx = mapContext, w = 288, h = 240, range = 155 * (1 + Math.min(1.6, altitude / 120)), scale = w / (2 * range), step = 12;
  ctx.fillStyle = '#32493b'; ctx.fillRect(0, 0, w, h);
  for (let iy = 0; iy < h; iy += step) for (let ix = 0; ix < w; ix += step) {
    const x = vehicle.x - (ix - w / 2) / scale, z = vehicle.z - (iy - h / 2) / scale, elev = world.height(x, z);
    // Lighter with height; the square root keeps plains varied and peaks below white.
    const band = Math.floor(Math.sqrt(Math.max(0, elev)) * 1.2), sand = world.desertAt(x, z, elev);
    ctx.fillStyle = world.waterAt(x, z) ? '#548c99' : `hsl(${mix(89 - band * 1.5, 40, sand)} ${mix(16, 38, sand)}% ${25 + band * 1.7 + sand * 13}%)`; ctx.fillRect(ix, iy, step + 1, step + 1);
  }
  const toMap = (x, z) => [w / 2 - (x - vehicle.x) * scale, h / 2 - (z - vehicle.z) * scale];
  // Rivers beneath the roads, as wide as they are (at least a line).
  ctx.strokeStyle = '#548c99'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const river of world.riversNear(vehicle.x, vehicle.z, range * 1.5 + 40)) {
    ctx.lineWidth = Math.max(1.6, river.width[river.count - 1] * scale);
    ctx.beginPath();
    for (let k = 0; k < river.count; k += 2) { const [mx, my] = toMap(river.points[k * 2], river.points[k * 2 + 1]); if (k) ctx.lineTo(mx, my); else ctx.moveTo(mx, my); }
    ctx.stroke();
  }
  for (const road of world.roadsNear(vehicle.x, vehicle.z, range * 1.5 + 40)) {
    // Highways bold, dirt tracks thin and dashed.
    ctx.strokeStyle = road.kind === 'highway' ? '#f0e2b0' : road.kind === 'dirt' ? '#b8a27a' : '#d6c99c';
    ctx.lineWidth = road.kind === 'highway' ? 3.6 : road.kind === 'dirt' ? 1.6 : 2.4; ctx.setLineDash(road.kind === 'dirt' ? [4, 3] : []);
    // About one point per two map pixels, however far the map has zoomed out.
    const every = Math.max(1, Math.round(2 / (scale * 10)));
    ctx.beginPath();
    for (let k = 0; k < road.count; k += every) { const [mx, my] = toMap(road.points[k * 2], road.points[k * 2 + 1]); if (k) ctx.lineTo(mx, my); else ctx.moveTo(mx, my); }
    const [ex, ey] = toMap(road.points[road.count * 2 - 2], road.points[road.count * 2 - 1]); ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = '#eee7cc18'; ctx.lineWidth = 1;
  for (let i = 24; i < w; i += 48) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
  for (let i = 24; i < h; i += 48) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
  for (const f of world.featuresNear(vehicle.x, vehicle.z, range * 1.4)) {
    const mx = w / 2 - (f.x - vehicle.x) * scale, my = h / 2 - (f.z - vehicle.z) * scale;
    ctx.save(); ctx.translate(mx, my); ctx.fillStyle = f.type === 'ramp' ? f.twist ? '#c69bf0' : '#ffb15e' : '#d8e4ce'; ctx.strokeStyle = '#24382e'; ctx.lineWidth = 2;
    if (f.type === 'ramp') { ctx.rotate(-f.heading); ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 5); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8); }
    ctx.restore();
  }
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-vehicle.heading);
  ctx.fillStyle = '#f6e3b7'; ctx.shadowBlur = 10; ctx.shadowColor = '#eaca8688';
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 9); ctx.lineTo(0, 5); ctx.lineTo(-7, 9); ctx.closePath(); ctx.fill(); ctx.restore();
  profiler.record('minimap', performance.now() - mapStarted);
}
function updateHUD() {
  const hudStarted = performance.now();
  const flying = vehicle.flying, planeMode = vehicle.flightMode || flying;
  const unfolding = vehicle.flight > 0 && vehicle.flight < 1, taxiing = vehicle.flightMode && vehicle.flight === 1 && !flying;
  const speed = Math.abs(flying ? vehicle.airspeed : vehicle.speed) * 3.6;
  $('speed').textContent = Math.round(speed); $('speedBar').style.width = clamp(speed / 340 * 100, 0, 100) + '%';
  $('gear').textContent = flying ? 'A' : vehicle.boatMode ? 'B' : speed < 1 ? 'N' : vehicle.speed < 0 ? 'R' : 'D';
  $('distance').textContent = (vehicle.distance / 1000).toFixed(2);
  const transforming = vehicle.transform > 0 && vehicle.transform < 1;
  $('modeKey').textContent = vehicle.floating && !planeMode ? 'W / S' : 'SPACE';
  $('modeAction').textContent = planeMode ? 'climb' : vehicle.floating ? 'throttle' : 'jump';
  $('brakeAction').textContent = planeMode ? 'dive' : vehicle.floating ? 'slow' : 'drift';
  $('flyAction').textContent = planeMode ? 'land' : 'fly';
  const touchJump = document.querySelector('[data-control="jump"]');
  touchJump.disabled = vehicle.floating && !planeMode;
  touchJump.textContent = 'JUMP'; touchJump.setAttribute('aria-label', 'Jump'); // hidden in the air: the ring pitches
  if (!planeMode) releaseRing();
  const touchBrake = document.querySelector('[data-control="brake"]');
  touchBrake.textContent = vehicle.floating ? 'SLOW' : 'DRIFT';
  touchBrake.setAttribute('aria-label', vehicle.floating ? 'Slow boat' : 'Drift');
  document.body.classList.toggle('plane-mode', planeMode);
  $('flyBtn').textContent = planeMode ? 'LAND' : 'FLY'; $('flyBtn').setAttribute('aria-label', planeMode ? 'Land' : 'Fly');
  const simple = simpleFlight;
  $('simpleBtn').classList.toggle('active', simple); $('simpleBtn').setAttribute('aria-pressed', String(simple));
  $('flightHint').classList.toggle('simple', simple);
  const altitude = vehicle.y - world.surface(vehicle.x, vehicle.z);
  $('surfaceState').textContent = flying ? vehicle.alpha > .24 || vehicle.airspeed < STALL_SPEED ? 'STALL WARNING — LOWER THE NOSE' : vehicle.flightMode ? 'FLYING' : 'GLIDING IN TO LAND'
    : unfolding ? vehicle.flightMode ? 'WINGS UNFOLDING' : 'FOLDING WINGS' : taxiing ? 'TAXIING' : transforming ? vehicle.boatMode ? 'DEPLOYING BOAT HULL' : 'RETURNING TO WHEELS' : vehicle.boatMode ? 'BOAT MODE' : !vehicle.grounded ? 'A LITTLE AIR' : input.brake && speed > 10 ? 'TAKE IT SIDEWAYS' : vehicle.onDirt ? 'ON THE TRACK' : vehicle.onRoad ? 'ON THE ROAD' : 'OFF THE BEATEN PATH';
  $('airtime').textContent = flying ? `ALT ${Math.round(altitude)} M · ${vehicle.vy >= 0 ? '+' : '−'}${Math.abs(vehicle.vy).toFixed(0)} M/S`
    : unfolding ? `WINGS · ${Math.round(vehicle.flight * 100)}%` : taxiing ? `LIFT-OFF AT ${Math.round(TAKEOFF_SPEED * 3.6)} KM/H` : transforming ? `TRANSFORMING · ${Math.round((vehicle.boatMode ? vehicle.transform : 1 - vehicle.transform) * 100)}%` : vehicle.floating ? `${vehicle.waterDepth.toFixed(1)} M WATER · W/S THROTTLE` : !vehicle.grounded ? `${Math.round(vehicle.airDistance)} M · ${vehicle.airtime.toFixed(1)} S AIR` : vehicle.bestJump > 5 ? 'BEST JUMP ' + Math.round(vehicle.bestJump) + ' M' : vehicle.bestAir > .4 ? 'BEST AIR ' + vehicle.bestAir.toFixed(1) + ' S' : 'READY TO ROAM';
  const lake = world.lakesNear(vehicle.x, vehicle.z, 700).sort((a, b) => Math.hypot(a.x - vehicle.x, a.z - vehicle.z) - Math.hypot(b.x - vehicle.x, b.z - vehicle.z))[0];
  if (lake) {
    const angle = Math.atan2(lake.x - vehicle.x, lake.z - vehicle.z) - vehicle.heading;
    const arrow = Math.cos(angle) < -.5 ? '↓' : Math.sin(angle) > .2 ? '↖' : Math.sin(angle) < -.2 ? '↗' : '↑';
    $('lakeHint').textContent = vehicle.floating ? 'RETURN TO SHORE TO DRIVE' : `${arrow} ${lake.sea ? 'SEA' : 'LAKE'} ${Math.round(Math.max(0, Math.hypot(lake.x - vehicle.x, lake.z - vehicle.z) - Math.min(lake.rx, lake.rz)))} M · AUTO BOAT`;
  } else $('lakeHint').textContent = 'DEEP WATER TRANSFORMS YOUR CAR';
  const ramps = world.featuresNear(vehicle.x, vehicle.z, 450).filter(f => f.type === 'ramp').sort((a, b) => Math.hypot(a.x - vehicle.x, a.z - vehicle.z) - Math.hypot(b.x - vehicle.x, b.z - vehicle.z));
  if (ramps.length) {
    const ramp = ramps[0], angle = Math.atan2(ramp.x - vehicle.x, ramp.z - vehicle.z) - vehicle.heading;
    $('rampHint').textContent = `${Math.sin(angle) > .2 ? '↖' : Math.sin(angle) < -.2 ? '↗' : Math.cos(angle) < 0 ? '↓' : '↑'} ${ramp.twist ? 'ROLL RAMP' : 'RAMP'} ${Math.round(Math.hypot(ramp.x - vehicle.x, ramp.z - vehicle.z))} M`;
  } else $('rampHint').textContent = 'EXPLORE FOR MORE RAMPS';
  const headings = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];
  $('headingTxt').textContent = headings[((Math.round(vehicle.heading / (Math.PI / 4)) % 8) + 8) % 8];
  $('biomeTxt').textContent = vehicle.waterDepth > 0 ? world.waterAt(vehicle.x, vehicle.z)?.lake.name ?? 'THE LAKES' : world.surface(vehicle.x, vehicle.z) > SNOW_LINE ? 'THE PEAKS' : world.desertAt(vehicle.x, vehicle.z) > .55 ? 'THE SANDLANDS' : world.mountainAt(vehicle.x, vehicle.z) > .62 ? 'THE HIGHLANDS' : world.woodlandAt(vehicle.x, vehicle.z) > .58 ? 'PINE COUNTRY' : 'OPEN MEADOW';
  if (weather.rain > .3 || weather.snow > .3) $('biomeTxt').textContent += weather.snow > weather.rain ? ' · SNOW' : ' · RAIN';
  $('biomeTxt').textContent += ` · ${clockLabel(clock.hours)}`;
  if (!lightsChosen && lightsOn !== dayLight.day < .45) { lightsOn = dayLight.day < .45; setHeadlights(lightsOn); }
  $('coordinates').textContent = `${Math.round(Math.abs(vehicle.x))} ${vehicle.x < 0 ? 'E' : 'W'} · ${Math.round(Math.abs(vehicle.z))} ${vehicle.z >= 0 ? 'N' : 'S'}`;
  $('elevation').textContent = Math.round(flying ? vehicle.y : vehicle.floating ? vehicle.waterLevel : world.surface(vehicle.x, vehicle.z)) + ' M';
  profiler.record('hud', performance.now() - hudStarted);
}
const vehiclePosition = new THREE.Vector3(), cameraPosition = new THREE.Vector3(), cameraTarget = new THREE.Vector3(), desiredCamera = new THREE.Vector3(), forward = new THREE.Vector3(), look = new THREE.Vector3();
const previousDesiredCamera = new THREE.Vector3(), previousLook = new THREE.Vector3(), attitude = new THREE.Quaternion();
let previousTargetFov = camera.fov;
const debris = createDebris(scene), rollPivot = new THREE.Vector3();
let onGround = 1; // eased: whether the car stands on the ground (for its slope lift)
// Dust off dirt tracks: sandy in the desert, earthy elsewhere; none in the wet.
const dust = createDust(scene), dustColor = new THREE.Color(), earthDust = new THREE.Color(.5, .43, .33), sandDust = new THREE.Color(.74, .64, .46);
let treeBreakage = null;
const vehiclePresentation = createVehiclePresentation(vehicle, (x, z, heading) => groundAt(world, x, z, heading).y);
let previousTime = performance.now(), accumulator = 0, uiTime = 0, mapTime = 0, idleRenderAt = 0, reportedLanding = 0;
let reportedBoat = vehicle.boatMode, reportedFlying = vehicle.flying, reportedPlane = vehicle.flightMode;
function updateDesiredCamera(pose = vehicle) {
  vehiclePosition.set(pose.x, pose.y, pose.z);
  // In flight the camera follows the nose in three dimensions, so it stays
  // behind the plane through climbs, dives and loops (and never rolls).
  if (pose.useAttitude ?? pose.flying) forward.set(0, 0, 1).applyQuaternion(attitude.set(pose.qx, pose.qy, pose.qz, pose.qw));
  else forward.set(Math.sin(pose.heading), 0, Math.cos(pose.heading));
  if (!started) {
    desiredCamera.set(pose.x - 8.5, pose.y + 4.6, pose.z - 11.8);
    look.set(pose.x + 2.7, pose.y + 1.2, pose.z + 3.5);
  } else if (cameraMode === 2 && running) {
    desiredCamera.copy(vehiclePosition).addScaledVector(forward, .7); desiredCamera.y += 1.91;
    look.copy(vehiclePosition).addScaledVector(forward, 25); look.y += 1.65;
  } else {
    const compact = camera.aspect < .85;
    // Wings out, the camera pulls back and up so the whole span stays in view.
    const wings = pose.flight ?? 0;
    const distance = ((cameraMode === 1 ? 18 : 10.6 + Math.abs(pose.speed) * .027) + wings * (cameraMode === 1 ? 8 : 7)) * (compact ? 1.4 : 1);
    desiredCamera.copy(vehiclePosition).addScaledVector(forward, -distance); desiredCamera.y += (cameraMode === 1 ? 10 : compact ? 5.8 : 4.7) + wings * 2.2;
    look.copy(vehiclePosition).addScaledVector(forward, (cameraMode === 1 ? 5 : 7) + wings * 8); look.y += 1.4;
  }
}
function render(dt) {
  const pose = vehiclePresentation.sample(running ? accumulator / FIXED_DT : 1);
  streamUniforms.uStreamCenter.value.set(pose.x, pose.z);
  for (const chunk of chunks.values()) grass.update(chunk.grassMesh, chunk.cx, chunk.cz, pose.x, pose.z);
  // Grass sways with the weather's wind (harder in a storm) and parts for the car.
  const breeze = Math.hypot(weather.gust.x, weather.gust.z) || 1, storm = 1 + .7 * Math.max(weather.rain, weather.snow);
  // The simulation clock, so pausing freezes the grass like everything else.
  grass.animate(pose.time, pose.x, pose.y, pose.z, weather.gust.x / breeze * storm, weather.gust.z / breeze * storm, Math.abs(pose.speed));
  roadLook.uCalm.value = smoothstep(11, 33, Math.abs(pose.speed)); // the road's fine detail softens at speed, like the grass
  if (pose.useAttitude) car.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
  else car.rotation.set(pose.pitch, pose.heading, pose.roll, 'YXZ');
  rollPivot.set(0, 1, 0).applyQuaternion(car.quaternion);
  // The body turns about its middle, 1 m up; held straight above the ground
  // contact, tilting it would sink the wheels (1/cos − 1: 22 cm on a 35°
  // climb). Lift it by that while it sits on the ground, easing in and out
  // over a tenth of a second: in the air (rolls, flight) it turns freely.
  onGround += ((vehicle.grounded && !vehicle.flying && !vehicle.floating ? 1 : 0) - onGround) * (1 - Math.exp(-dt * 12));
  const upright = rollPivot.y, lift = upright > .5 ? Math.min(.45, 1 / upright - 1) * onGround : 0;
  car.position.set(pose.x - rollPivot.x, pose.y + 1 - rollPivot.y + lift, pose.z - rollPivot.z);
  if (transformation) profiler.measure('transformAnimation', () => { transformation.update(pose.transform); flightRig.update(pose.flight); });
  if (propeller) { propellerAngle += dt * pose.flight * (18 + Math.abs(pose.speed) * .45); propeller.rotation.z = propellerAngle; }
  body.position.y = -pose.impact * .3 * (1 - pose.transform);
  body.rotation.z = -pose.steer * Math.min(Math.abs(pose.speed) / 25, 1) * .055 * (1 - pose.transform) * (1 - pose.flight);
  // With the wings out (taxiing or flying) the throttle is the flight axis:
  // on the full controls ↑/↓ pitch and Shift dives, none of them throttle or
  // brakes, so the engine sound and brake lamps follow W/S alone.
  const wingsActive = vehicle.flying || (vehicle.flightMode && vehicle.flight === 1);
  const throttle = wingsActive ? flightAxes(input).throttle : throttleInput();
  body.rotation.x = (throttle > 0 ? -.012 * throttle : -.024 * throttle) * (1 - pose.transform);
  wheelSpinners.forEach(w => w.rotation.x = pose.wheelAngle);
  wheelPivots.forEach(p => { if (p.name.startsWith('Wheel_F')) p.rotation.y = pose.steer * .4 * (1 - pose.transform); });
  brakeMat.emissiveIntensity = throttle < -.05 || (input.brake && !wingsActive) ? 2 : .25;
  car.visible = cameraMode !== 2 || !running;
  contact.position.set(pose.x, world.surface(pose.x, pose.z) + .035, pose.z);
  contact.rotation.set(-Math.PI / 2 + pose.pitch, 0, -pose.heading, 'YXZ');
  // The contact shadow helps judge jumps; high above the ground it fades out.
  const height = pose.y - pose.groundY;
  contact.material.opacity = clamp(1 - height * .13, .25, 1) * (1 - smoothstep(8, 30, height));
  updateDesiredCamera(pose);
  followTarget(cameraPosition, previousDesiredCamera, desiredCamera, 5, !started || cameraMode === 2 && running ? 0 : dt);
  keepCameraInView(pose.x, pose.y + 1.2, pose.z);
  camera.position.copy(cameraPosition);
  followTarget(cameraTarget, previousLook, look, 8, !started ? 0 : dt);
  camera.lookAt(cameraTarget);
  const targetFov = cameraMode === 2 ? 67 : 57 + (reducedMotion ? 0 : Math.min(Math.abs(pose.speed) * .15, 10));
  const nextFov = followValue(camera.fov, previousTargetFov, targetFov, 2.45, dt);
  previousTargetFov = targetFov;
  if (Math.abs(camera.fov - nextFov) > 1e-6) { camera.fov = nextFov; camera.updateProjectionMatrix(); }
  sky.mesh.position.copy(camera.position);
  // Cloud banks drift with the weather's wind, faster aloft and in storms.
  const aloftWind = Math.hypot(weather.gust.x, weather.gust.z) || 1, windSpeed = 7 + 9 * Math.max(weather.rain, weather.snow);
  clouds.update(camera, running ? dt : 0, weather.gust.x / aloftWind * windSpeed, weather.gust.z / aloftWind * windSpeed, weather.clouds);
  // From the air, see further: fog recedes onto the horizon terrain tier as
  // the camera climbs, and the near plane moves out to keep depth precision.
  const aloft = smoothstep(40, 320, camera.position.y - world.surface(camera.position.x, camera.position.z));
  // Rain and snow close the fog in.
  const cover = updateWeather(dt), murk = 1 - .5 * cover;
  scene.fog.near = fogUniforms.uFogNear.value = (350 + aloft * 900) * murk;
  scene.fog.far = fogUniforms.uFogFar.value = (1450 + aloft * 2900) * (1 - .35 * cover);
  const near = cameraMode === 2 && running ? .1 : .1 + aloft * 1.4;
  if (Math.abs(camera.near - near) > .02) { camera.near = near; camera.updateProjectionMatrix(); }
  // The 96 m shadow map sits 18 m ahead of the car along the view, where the
  // ground is actually seen, so shadows fade in well ahead even at speed.
  camera.getWorldDirection(shadowAhead).setY(0);
  if (shadowAhead.lengthSq() < 1e-4) shadowAhead.set(Math.sin(pose.heading), 0, Math.cos(pose.heading));
  shadowAhead.normalize().multiplyScalar(18).add(car.position);
  snapToTexels(shadowAhead, 96, sun.shadow.mapSize.x);
  sun.target.position.copy(shadowAhead); sun.position.copy(shadowAhead).addScaledVector(sunDirection, 127.5); sun.target.updateMatrixWorld();
  if (farSun.castShadow) {
    camera.getWorldDirection(farAhead).setY(0);
    if (farAhead.lengthSq() < 1e-4) farAhead.set(Math.sin(pose.heading), 0, Math.cos(pose.heading));
    farAhead.normalize().multiplyScalar(FAR_SHADOW_AHEAD).add(car.position);
    snapToTexels(farAhead, FAR_SHADOW * 2, farSun.shadow.mapSize.x);
    farSun.target.position.copy(farAhead); farSun.position.copy(farAhead).addScaledVector(sunDirection, 320); farSun.target.updateMatrixWorld();
  }
  profiler.measure('waterUpdate', () => waterSystem.update(world, pose, dt));
  const splashes = waterSystem.drainSplashes();
  if (audio && running && !muted) profiler.measure('audio', () => updateSound(throttle, splashes, dt));
  headlight.getWorldPosition(headlightAt); lightTarget.getWorldPosition(headlightAim);
  roadLook.uHeadlight.value.set(headlightAt.x, headlightAt.y, headlightAt.z, headlight.intensity > 0 ? .35 + .65 * dayLight.night : 0);
  roadLook.uHeadlightDir.value.copy(headlightAim.sub(headlightAt).normalize());
  const renderStarted = performance.now();
  const timed = perfMeter.visible && gpuTimer;
  if (timed) gpuTimer.begin();
  // Through the motion blur while driving or flying (on the menus nothing
  // moves); on computers through its target either way.
  const blur = settings.motionBlur && running;
  if (blur || !screenMultisampled) { motionBlur.render(scene, camera, car.visible ? car : null, blur); drawStats = motionBlur.stats; }
  else { renderer.render(scene, camera); motionBlur.reset(); drawStats = renderer.info.render; }
  if (timed) gpuTimer.end();
  profiler.record('renderCPU', performance.now() - renderStarted, testMode ? { time: pose.time, transform: pose.transform, wakes: waterSystem.wakeCount } : undefined);
}
function frame(now) {
  requestAnimationFrame(frame);
  const frameStarted = performance.now();
  // Test mode catches up to real time even at software-rendering frame rates
  // (~4 fps); physics still advances in identical fixed steps.
  const dt = clamp((now - previousTime) / 1000, 0, testMode ? .5 : .1); previousTime = now;
  if (document.hidden) return;
  if (running) profiler.record('frame', (now - (frame.lastNow || now)));
  // Auto quality reacts to sustained frame intervals while actually driving.
  if (auto && running && !loading && drivable() && frame.lastNow) {
    const next = auto.sample(now - frame.lastNow, now);
    if (next !== null) { applyQuality(next); settings.autoLevel = next; saveSettings(); }
  }
  frame.lastNow = now;
  // Work out the roads ahead a little at a time (the workers have their own
  // copies), so driving into new country never waits on routing. Loading
  // waits for those within 1.6 km (with more time a frame for them).
  roadsReady = profiler.measure('roadPrep', () => loading ? world.prepareRoads(vehicle.x, vehicle.z, 1600, 30) : world.prepareRoads(vehicle.x, vehicle.z, 3000, 1.5));
  const wasLoading = loading;
  processStreaming();
  // Loading completion resets the clock; do not apply this frame’s old delta.
  if (wasLoading && !loading) { render(0); return; }
  if (!running) { if (now - idleRenderAt < (loading ? 100 : 200)) return; idleRenderAt = now; }
  if (running && drivable()) {
    const physicsStarted = performance.now();
    accumulator += dt;
    const obstacles = nearbyObstacles();
    while (accumulator >= FIXED_DT) {
      stepVehicle(vehicle, input, world, obstacles);
      vehiclePresentation.advance(vehicle, FIXED_DT); accumulator -= FIXED_DT;
    }
    profiler.record('physics', performance.now() - physicsStarted);
    processBreakage(); debris.update(dt, world); treeBreakage.update(dt, world); updateFallingSigns(dt);
    dustColor.copy(earthDust).lerp(sandDust, world.desertAt(vehicle.x, vehicle.z));
    dust.update(dt, vehicle, vehicle.onDirt && roadLook.uWet.value < .3 && roadLook.uSnowCover.value < .3, dustColor, renderer.domElement.height, camera.fov);
    if (vehicle.boatMode !== reportedBoat) {
      reportedBoat = vehicle.boatMode;
      toast(reportedBoat ? 'Deep water — deploying boat hull' : 'Shore reached — returning to wheels');
    }
    // Tilt pitch is measured from how the phone is held when the wings come out.
    if (vehicle.flightMode !== reportedPlane) { reportedPlane = vehicle.flightMode; if (reportedPlane && tilt.reading) tilt.neutral = tilt.reading.lean; }
    if (vehicle.flying !== reportedFlying) {
      reportedFlying = vehicle.flying;
      toast(reportedFlying ? coarse ? settings.tilt ? 'Airborne · turn the phone to roll · tilt toward you to climb, away to dive · LAND folds the wings' : 'Airborne · drag the ring to climb, dive and roll · SIMPLE for easy controls · LAND folds the wings' : 'Airborne · Space climbs · Shift dives · T simple controls · F lands'
        : vehicle.floating ? 'Splashdown — back to boat' : 'Touchdown');
    }
    if (vehicle.landings > reportedLanding) {
      reportedLanding = vehicle.landings;
      if (vehicle.airDistance > 25) toast(`${vehicle.airRoll > Math.PI ? 'Barrel roll! · ' : ''}${Math.round(vehicle.airDistance)} m jump · ${vehicle.airtime.toFixed(1)} seconds of air`);
    }
    streamWorld(); uiTime += dt; mapTime += dt;
    if (uiTime > .12) { uiTime = 0; updateHUD(); }
    if (!coarse && mapTime > .3) { mapTime = 0; drawMap(); } // phones have no minimap
  }
  render(running ? dt : 0);
  const frameCPU = performance.now() - frameStarted;
  if (running) profiler.record('frameCPU', frameCPU);
  if (perfMeter.visible) perfMeter.frame(frameCPU, now, { draws: drawStats.calls, triangles: drawStats.triangles, level: qualityNames[levels[qualityLevel].name] ?? 'Medium+', pixelRatio: renderer.getPixelRatio(), paused: !running }, gpuTimer ? gpuTimer.drain() : null);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  // Moving between displays can change devicePixelRatio.
  renderer.setPixelRatio(Math.min(devicePixelRatio, levels[qualityLevel].pixelRatio));
});
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); pause(); toast('Graphics paused. Reload to restore the drive.'); });

syncSeed(); syncSound(); syncSettings(); beginWorldLoad(); resetCamera(); updateHUD(); drawMap(); render(0);
requestAnimationFrame(frame);

profiler.record('initialLoad', performance.now() - bootStarted);
if (testMode) window.__driveTest = { resetMetrics: () => profiler.reset(), snapshot: () => {
  const visibleGrass = [...chunks.values()].filter(c => c.group.visible && c.grassMesh?.visible);
  const tufts = visibleGrass.reduce((n, c) => n + c.grassMesh.geometry.instanceCount, 0);
  const grassStats = { range: grass.range, meshes: visibleGrass.length, tufts, triangles: tufts * grass.trianglesPerTuft };
  let carMeshes = 0, carDraws = 0; car.traverse(o => { if (o.isMesh) carMeshes++; }); car.traverseVisible(o => { if (o.isMesh) carDraws++; });
  let hiddenProps = 0;
  for (const chunk of chunks.values()) for (const [id, refs] of chunk.propInstances) {
    if (!world.brokenProps.has(id)) continue;
    const hidden = refs.every(({ mesh, index }) => { mesh.getMatrixAt(index, matrix); return matrix.elements[0] === 0 && matrix.elements[5] === 0 && matrix.elements[10] === 0; });
    if (hidden) hiddenProps++;
  }
  const natureInstances = {};
  for (const chunk of chunks.values()) if (chunk.group.visible) chunk.group.traverse(o => { if (o.isInstancedMesh && o.userData.natureKind) natureInstances[o.userData.natureKind] = (natureInstances[o.userData.natureKind] || 0) + o.count; });
  const impostorCount = [...farTiles.values()].reduce((n, t) => n + (t.userData.impostors?.meshes ?? []).reduce((m, mesh) => m + (mesh.isInstancedMesh ? mesh.count : 0), 0), 0);
  return { clouds: { cloudiness: weather.clouds, drift: clouds.drift.toArray(), banks: clouds.count }, time: { hours: clock.hours, clock: clockLabel(clock.hours), day: dayLight.day, night: dayLight.night, sunHeight: dayLight.sun[1], key: sun.intensity, exposure: renderer.toneMappingExposure, headlights: lightsOn }, weather: { kind: weather.target.kind, region: weather.target.region, chance: weather.target.chance, rain: weather.rain, snow: weather.snow, particles: weatherFx.counts, fogColor: '#' + scene.fog.color.getHexString(), sun: sun.intensity }, horizon: { ultraTiles: ultraTiles.size, impostors: impostorCount, impostorsVisible: impostorsEnabled, distantWater: waterSystem.distantCount, fogNear: scene.fog.near, fogFar: scene.fog.far, cameraNear: camera.near }, flight: { mode: vehicle.flightMode, progress: vehicle.flight, flying: vehicle.flying, simpleControls: simpleFlight, airspeed: vehicle.airspeed, altitude: vehicle.y - world.surface(vehicle.x, vehicle.z), propeller: propellerAngle, wingsVisible: car.getObjectByName('WingSeg1_L')?.visible ?? false, wingspan: car.getObjectByName('WingSeg3_L') ? car.getObjectByName('WingSeg3_L').getWorldPosition(new THREE.Vector3()).distanceTo(car.getObjectByName('WingSeg3_R').getWorldPosition(new THREE.Vector3())) : 0, clouds: clouds.count }, quality: { preset: settings.quality, level: levels[qualityLevel].name, pixelRatio: renderer.getPixelRatio(), shadow: sun.shadow.mapSize.x, farShadow: farSun.castShadow ? farSun.shadow.mapSize.x : 0, grassDensity: grass.density }, controls: { sensitivity: settings.sensitivity, tilt: settings.tilt, tiltActive: tiltActive(), pitchAxis: input.pitchAxis ?? null, steer: input.steer ?? null, throttle: throttleInput() }, water: { lakes: waterSystem.count, wakes: waterSystem.wakeCount }, natureAsset: { ready: Boolean(nature), error: natureError, assets: nature?.stats ?? [], instances: natureInstances }, grass: grassStats, metrics: profiler.snapshot(), draws: drawStats.calls, triangles: drawStats.triangles, motionBlur: settings.motionBlur, carMeshes, carDraws, carAsset: { ready: carReady, error: carError, name: 'ATLAS Amphibious', animationDuration: transformation?.duration, hullSpan: car.getObjectByName('Hull_R')?.position.x - car.getObjectByName('Hull_L')?.position.x, triangles: carTriangles, wheelPivots: wheelPivots.map(p => p.parent.position.toArray()), wheelSteer: wheelPivots.map(p => p.rotation.y), wheelSpin: wheelSpinners.map(p => p.rotation.x), headlights: headMat.emissiveIntensity, brakes: brakeMat.emissiveIntensity }, chunks: chunks.size, farTiles: farTiles.size, loading, generation, streamError, pending: pending.size, stalePending: [...pending.values()].filter(job => job.generation !== generation).length, queued: jobs.length, carBatching: carBatching.map(({ before, after }) => ({ before, after })), vehicle: { ...vehicle }, renderPose: { ...vehiclePresentation.pose }, debris: debris.count, fallingTrees: treeBreakage?.count ?? 0, sound: audio ? { muted, played: audio.breaks.played, active: audio.breaks.active, effects: audio.vehicle.played, effectTypes: audio.vehicle.playedBy, gear: audio.vehicle.gear, masterGain: audio.master.gain.value } : null, brokenProps: world.brokenProps.size, hiddenProps, accumulator, cameraError: cameraPosition.distanceTo(desiredCamera) + cameraTarget.distanceTo(look), camera: cameraPosition.toArray(), target: cameraTarget.toArray() };
} };
