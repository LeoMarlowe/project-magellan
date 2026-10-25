import * as THREE from 'three';
import { hash } from './world.mjs?v=roadster-1';

// Soft, seeded cloud banks at 230–350 m, high enough to fly through. One
// instanced draw of camera-facing puffs; they fade near the camera (no hard
// clipping while flying through) and into the fog at distance. The whole field
// drifts with the wind, puffs slowly swell and shrink, and how many of the
// banks are present follows the cloudiness: each bank has a rank and fades in
// once the cloudiness passes it, so skies fill and clear gradually.
export const CLOUD_CELL = 520;
// Cells of puffs exist out to RANGE cells from the camera's cell, so a new row
// of cells appears at least RANGE cells (1,560 m) away; every puff fades in
// with distance and is still fully transparent there, so none pops in.
const RANGE = 3, PUFFS = 7, FADE_FAR = RANGE * CLOUD_CELL - 120, FADE_NEAR = FADE_FAR - 520;

function puffTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  // Overlapping soft lobes make an irregular, fluffy silhouette.
  for (const [x, y, r, a] of [[64, 70, 46, .9], [40, 74, 30, .7], [88, 72, 32, .7], [56, 52, 30, .65], [78, 50, 26, .6]]) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`); grad.addColorStop(.6, `rgba(244,247,247,${a * .55})`); grad.addColorStop(1, 'rgba(240,244,245,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createClouds(scene, seed) {
  const capacity = (RANGE * 2 + 1) ** 2 * PUFFS;
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index; geometry.setAttribute('position', base.getAttribute('position')); geometry.setAttribute('uv', base.getAttribute('uv'));
  const offsets = new Float32Array(capacity * 3), sizes = new Float32Array(capacity), alphas = new Float32Array(capacity), ranks = new Float32Array(capacity);
  geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute('size', new THREE.InstancedBufferAttribute(sizes, 1));
  geometry.setAttribute('alpha', new THREE.InstancedBufferAttribute(alphas, 1));
  geometry.setAttribute('rank', new THREE.InstancedBufferAttribute(ranks, 1));
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uShade: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) }, uDrift: { value: new THREE.Vector2() }, uClouds: { value: .38 }, uTime: { value: 0 } }]),
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      attribute vec3 offset; attribute float size; attribute float alpha; attribute float rank;
      uniform vec2 uDrift; uniform float uClouds, uTime;
      varying vec2 vUv; varying float vAlpha;
      void main(){
        vUv = uv;
        vec3 world = offset + vec3(uDrift.x, 0.0, uDrift.y);
        // Banks present: a rank below the cover fades in (about half at a
        // typical meadow sky, all of them when overcast, a few over the desert).
        float cover = clamp(uClouds * 1.3, 0.0, 1.0), present = 1.0 - smoothstep(cover - .12, cover, rank);
        float phase = fract(sin(dot(offset.xz, vec2(.0123, .0371))) * 4375.85) * 6.283;
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        mvPosition.xy += position.xy * size * (.82 + .18 * sin(uTime * .045 + phase)) * (.7 + .3 * present);
        float across = length(world.xz - cameraPosition.xz);
        vAlpha = alpha * present * smoothstep(18.0, 75.0, length(mvPosition.xyz)) * (1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, across));
        gl_Position = vAlpha < .004 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mvPosition; // hidden puffs cost nothing
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform sampler2D map; uniform float uShade; uniform vec3 uLight; varying vec2 vUv; varying float vAlpha;
      void main(){
        vec4 t = texture2D(map, vUv);
        if (t.a * vAlpha < .01) discard;
        // Rain clouds are darker and greyer underneath.
        vec3 tone = mix(mix(vec3(.78,.83,.85), vec3(1.0), smoothstep(.2, .9, vUv.y)), mix(vec3(.5,.54,.57), vec3(.74,.77,.79), smoothstep(.2, .9, vUv.y)), uShade);
        gl_FragColor = vec4(tone * t.rgb * uLight, t.a * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  material.uniforms.map.value = puffTexture();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = 'Clouds';
  scene.add(mesh);
  let cellX = Infinity, cellZ = Infinity;
  const drift = new THREE.Vector2();
  function rebuild(camera) {
    const puffs = [];
    for (let dx = -RANGE; dx <= RANGE; dx++) for (let dz = -RANGE; dz <= RANGE; dz++) {
      const cx = cellX + dx, cz = cellZ + dz;
      const rank = hash(cx, cz, seed + 4401);
      const x = (cx + .2 + hash(cx, cz, seed + 4402) * .6) * CLOUD_CELL, z = (cz + .2 + hash(cx, cz, seed + 4403) * .6) * CLOUD_CELL;
      const y = 230 + hash(cx, cz, seed + 4404) * 120;
      for (let i = 0; i < PUFFS; i++) {
        const r = (k) => hash(cx * 31 + i, cz * 17 + k, seed + 4410);
        puffs.push({ x: x + (r(1) - .5) * 150, y: y + (r(2) - .5) * 30, z: z + (r(3) - .5) * 150, size: 45 + r(4) * 55, alpha: .55 + r(5) * .3, rank });
      }
    }
    // Back to front from the current camera, so overlapping puffs blend well.
    const cx = camera.position.x - drift.x, cz = camera.position.z - drift.y;
    puffs.sort((a, b) => Math.hypot(b.x - cx, b.z - cz) - Math.hypot(a.x - cx, a.z - cz));
    puffs.forEach((p, i) => { offsets.set([p.x, p.y, p.z], i * 3); sizes[i] = p.size; alphas[i] = p.alpha; ranks[i] = p.rank; });
    geometry.instanceCount = puffs.length;
    for (const name of ['offset', 'size', 'alpha', 'rank']) geometry.getAttribute(name).needsUpdate = true;
  }
  return {
    mesh,
    // wind: drift velocity in m/s on the ground plane; cloudiness 0–1.
    update(camera, dt = 0, windX = 0, windZ = 0, cloudiness = .38) {
      drift.x += windX * dt; drift.y += windZ * dt; material.uniforms.uTime.value += dt;
      material.uniforms.uDrift.value.copy(drift); material.uniforms.uClouds.value = cloudiness;
      // Cells are laid out in the drifting frame, so a new row still appears
      // at least RANGE cells away from the camera, as before.
      const cx = Math.floor((camera.position.x - drift.x) / CLOUD_CELL), cz = Math.floor((camera.position.z - drift.y) / CLOUD_CELL);
      if (cx !== cellX || cz !== cellZ) { cellX = cx; cellZ = cz; rebuild(camera); }
    },
    reset(nextSeed) { seed = nextSeed; cellX = cellZ = Infinity; drift.set(0, 0); },
    // 0 fair-weather white, 1 grey rain cloud.
    setShade(value) { material.uniforms.uShade.value = value; },
    // The colour of the light on the clouds: white by day, warm at sunrise and
    // sunset, dark blue at night.
    setLight(color) { material.uniforms.uLight.value.copy(color); },
    get count() { return geometry.instanceCount; },
    get drift() { return drift.clone(); },
  };
}
