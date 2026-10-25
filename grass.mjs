import * as THREE from 'three';
import { CHUNK, smoothstep } from './world.mjs?v=roadster-1';

// Quality presets change density, fade and range live: the worker always
// supplies the full shuffled set, and lower densities draw a prefix of it.
const SIMPLE_VERTICES = 15, FULL_VERTICES = 45;
// How much of the tufts' contrast fades at full speed (see animate).
export const CALM = .6;
export function createGrass(center, quality = { density: 1, range: 78, fade: 38 }) {
  const fadeUniform = { value: 0 }, rangeUniform = { value: 0 }, densityUniform = { value: 1 };
  let density = 1, range = 78;
  let simple = false;
  function setQuality(next) {
    density = next.density; range = next.range; densityUniform.value = next.density; simple = next.blades === 'simple';
    fadeUniform.value = next.fade; rangeUniform.value = next.range;
  }
  setQuality(quality);
  // Five tapered blades per tuft, each bent in two segments (three
  // triangles) and leaning outward at its own angle. Opaque triangles avoid
  // transparent overdraw and sorting; grass never casts shadows or collides.
  // The first 15 vertices are a cheap version for Low and Medium: the same
  // five blades as single straight triangles (5 per tuft instead of 15). The
  // preset picks which range to draw, so switching quality is instant.
  const positions = [];
  for (let blade = 0; blade < 5; blade++) {
    const angle = blade * Math.PI * 2 / 5 + (blade % 2) * .4, c = Math.cos(angle), s = Math.sin(angle);
    const tall = 1 - (blade % 3) * .14, lean = .24 + (blade % 2) * .14, w = .085 + (blade % 3) * .015;
    for (const [x, y, z] of [[-w, 0, .02], [w, 0, .02], [0, tall, lean]]) positions.push(x * c - z * s, y, x * s + z * c);
  }
  for (let blade = 0; blade < 5; blade++) {
    const angle = blade * Math.PI * 2 / 5 + (blade % 2) * .4, c = Math.cos(angle), s = Math.sin(angle);
    const tall = 1 - (blade % 3) * .14, lean = .24 + (blade % 2) * .14, w = .085 + (blade % 3) * .015;
    // Base pair, a mid pair bent outward, and the tip (x across, z outward).
    const v = [[-w, 0, .02], [w, 0, .02], [-w * .6, tall * .55, lean * .45], [w * .6, tall * .55, lean * .45], [0, tall, lean]];
    for (const k of [0, 1, 2, 2, 1, 3, 2, 3, 4]) { const [x, y, z] = v[k]; positions.push(x * c - z * s, y, x * s + z * c); }
  }
  const base = new THREE.BufferGeometry(); base.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  base.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  // Wind and the car: blades sway in gusts rolling across the field and are
  // pushed aside where the car passes. All in the vertex shader.
  const time = { value: 0 }, car = { value: new THREE.Vector3(1e6, 0, 1e6) }, wind = { value: new THREE.Vector2(.8, .6) }, rush = { value: 0 }, calm = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uGrassCenter: center, uGrassFade: fadeUniform, uGrassRange: rangeUniform, uGrassTime: time, uGrassCar: car, uGrassWind: wind, uGrassDensity: densityUniform, uGrassRush: rush, uGrassCalm: calm });
    shader.vertexShader = `attribute vec3 grassRoot; attribute vec3 grassShape; attribute vec3 grassColor; attribute float grassRank;
      uniform vec2 uGrassCenter, uGrassWind; uniform float uGrassFade, uGrassRange, uGrassTime, uGrassDensity, uGrassRush; uniform vec3 uGrassCar;
      varying float vGrassHeight; varying float vGrassTint; varying vec3 vGrassColor;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
      #include <beginnormal_vertex>
      float c = cos(grassShape.y), s = sin(grassShape.y);
      objectNormal.xz = mat2(c, s, -s, c) * objectNormal.xz;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      vec3 rootWorld = (modelMatrix * vec4(grassRoot, 1.0)).xyz;
      float seen = distance(rootWorld.xz, uGrassCenter);
      float coverage = 1.0 - smoothstep(uGrassFade, uGrassRange, seen);
      // Thinning with distance: each tuft (by its place in the shuffled set)
      // shrinks away smoothly as the kept share falls below it, so none pop.
      float keep = uGrassDensity * (1.0 - .55 * smoothstep(24.0, uGrassRange, seen));
      coverage *= 1.0 - smoothstep(keep - .07, keep, grassRank);
      // At speed, tufts within a few metres of the camera rush past too fast
      // to read and only flicker: they shrink away.
      coverage *= 1.0 - uGrassRush * (1.0 - smoothstep(3.0, 8.0, distance(rootWorld, cameraPosition)));
      vec3 transformed = position;
      transformed.xz = mat2(c, s, -s, c) * transformed.xz;
      transformed *= grassShape.x * coverage;
      // Bend grows with height squared, so roots stay put.
      float bend = position.y * position.y * grassShape.x * coverage;
      // The gust ripple travels along a fixed direction: tying its phase to the
      // turning wind vector would make it race and stutter far from the origin.
      float gust = sin(dot(rootWorld.xz, vec2(.8, .6)) * .09 + uGrassTime * 1.6) * .5 + .5;
      float flutter = sin(uGrassTime * 4.7 + rootWorld.x * 1.9 + rootWorld.z * 1.3);
      vec2 sway = uGrassWind * (.1 + .32 * gust * gust) + vec2(-uGrassWind.y, uGrassWind.x) * flutter * .05;
      vec2 away = rootWorld.xz - uGrassCar.xz; float gap = length(away);
      float push = (1.0 - smoothstep(.9, 2.8, gap)) * (1.0 - smoothstep(1.5, 3.0, abs(rootWorld.y - uGrassCar.y)));
      sway += away / max(gap, .05) * push * .9;
      transformed.xz += sway * bend; transformed.y *= 1.0 - push * .45;
      transformed += grassRoot;
      vGrassHeight = position.y; vGrassTint = grassShape.z; vGrassColor = grassColor;
    `);
    shader.fragmentShader = 'varying float vGrassHeight; varying float vGrassTint; varying vec3 vGrassColor; uniform float uGrassCalm;\n' + shader.fragmentShader;
    // Treat thin blades as a soft canopy: both sides use an upward lighting
    // normal instead of alternating between bright faces and black slivers.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    // The ground's own colour, darker at the root and lighter, slightly
    // yellower at the tip, so tufts grow out of the terrain rather than sit on it.
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 grassTip = vGrassColor * vec3(1.28, 1.24, 1.02) + vec3(.03, .03, 0.0);
      // At speed the tufts move further between frames than the eye can match
      // them up, so the field seems to stutter at any frame rate. Their light
      // and dark ease toward the ground colour, as motion blur would smear them.
      diffuseColor.rgb *= mix(mix(vGrassColor * .62, grassTip, smoothstep(.0, 1.0, vGrassHeight)) * vGrassTint, vGrassColor, uGrassCalm);`);
  };
  material.customProgramCacheKey = () => 'grass-v6';
  function build(data) {
    const total = data.roots.length / 3;
    if (!total) return null;
    const geometry = new THREE.InstancedBufferGeometry();
    // Attribute ownership prevents chunk disposal invalidating another mesh.
    geometry.setAttribute('position', base.getAttribute('position').clone()); geometry.setAttribute('normal', base.getAttribute('normal').clone());
    geometry.setAttribute('grassRoot', new THREE.InstancedBufferAttribute(data.roots, 3));
    geometry.setAttribute('grassShape', new THREE.InstancedBufferAttribute(data.shapes, 3));
    geometry.setAttribute('grassRank', new THREE.InstancedBufferAttribute(Float32Array.from({ length: total }, (_, i) => (i + .5) / total), 1));
    geometry.setAttribute('grassColor', new THREE.InstancedBufferAttribute(data.colors ?? new Float32Array(total * 3).fill(.25), 3));
    geometry.userData.total = total;
    geometry.instanceCount = Math.floor(total * density);
    if (simple) geometry.setDrawRange(0, SIMPLE_VERTICES); else geometry.setDrawRange(SIMPLE_VERTICES, FULL_VERTICES);
    let low = Infinity, high = -Infinity;
    for (let i = 1; i < data.roots.length; i += 3) { low = Math.min(low, data.roots[i]); high = Math.max(high, data.roots[i]); }
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(0, low, 0), new THREE.Vector3(CHUNK, high + 1, CHUNK));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    geometry.userData.owned = true;
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true;
    return mesh;
  }
  function update(mesh, cx, cz, x, z) {
    if (!mesh) return;
    const dx = Math.max(cx * CHUNK - x, 0, x - (cx + 1) * CHUNK);
    const dz = Math.max(cz * CHUNK - z, 0, z - (cz + 1) * CHUNK);
    // Full density in and next to the car's chunk, thinning toward the range
    // edge (where tufts are small anyway): a prefix of the shuffled set. The
    // shader fades each tuft by its own distance (gone once its rank reaches
    // the kept share); this only skips tufts already gone, measured from the
    // chunk's nearest point less a margin, as the shader's centre can lag.
    const taper = 1 - .55 * smoothstep(24, range, Math.max(0, Math.hypot(dx, dz) - 12));
    mesh.geometry.instanceCount = Math.min(mesh.geometry.userData.total, Math.floor(mesh.geometry.userData.total * density * taper));
    if (simple) mesh.geometry.setDrawRange(0, SIMPLE_VERTICES); else mesh.geometry.setDrawRange(SIMPLE_VERTICES, FULL_VERTICES);
    mesh.visible = mesh.geometry.instanceCount > 0 && dx * dx + dz * dz < range * range;
  }
  // Each frame: the clock for the wind, and the car (in world space) pushing blades aside.
  // wind: direction and strength on the ground plane (1 is a breeze); speed
  // in m/s thins the grass right by the camera from about 80 to 180 km/h, and
  // softens the tufts' contrast by up to 60% from about 40 to 120 km/h.
  function animate(seconds, x, y, z, windX = .8, windZ = .6, speed = 0) {
    time.value = seconds; car.value.set(x, y, z); wind.value.set(windX, windZ);
    rush.value = smoothstep(22, 50, speed); calm.value = CALM * smoothstep(11, 33, speed);
  }
  // An empty mesh with the grass material, so its shader can be built during
  // loading even where no grass is in view yet (out at sea, in the desert).
  const warmup = new THREE.Mesh(new THREE.BufferGeometry(), material);
  return { build, update, animate, setQuality, warmup, get range() { return range; }, get fadeStart() { return fadeUniform.value; }, get density() { return density; }, get trianglesPerTuft() { return simple ? 5 : 15; }, get calm() { return calm.value; } };
}
