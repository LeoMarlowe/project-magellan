import * as THREE from 'three';
import { waterWave, lakeExtent } from './lakes.mjs?v=classes-2';

// A small tileable wave texture, generated once (no download): R/G hold the
// surface slope from a sum of periodic waves, B a soft noise used to break up
// foam. Power-of-two with mipmaps, so detail filters out cleanly with distance
// instead of shimmering.
function waveTexture(size = 128) {
  const data = new Uint8Array(size * size * 4), waves = [];
  let seed = 7;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  // Mostly short waves running roughly downwind, so the surface reads as
  // wind chop rather than large marbled blobs. Whole wave numbers keep the
  // tile seamless.
  while (waves.length < 28) {
    const angle = .6 + (random() - .5) * 2.2, k = 3 + random() * 13;
    const kx = Math.round(Math.cos(angle) * k), kz = Math.round(Math.sin(angle) * k), real = Math.hypot(kx, kz);
    if (real < 2.5) continue;
    waves.push([kx, kz, 1 / Math.pow(real, 1.5), random() * Math.PI * 2]);
  }
  const slopes = new Float32Array(size * size * 2); let peak = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let sx = 0, sz = 0; const u = x / size, v = y / size;
    for (const [kx, kz, a, phase] of waves) { const c = Math.cos(Math.PI * 2 * (kx * u + kz * v) + phase) * a; sx += c * kx; sz += c * kz; }
    slopes.set([sx, sz], (y * size + x) * 2); peak = Math.max(peak, Math.abs(sx), Math.abs(sz));
  }
  // Periodic value noise for the foam mask.
  const cells = 8, lattice = Array.from({ length: cells * cells }, random);
  const noise = (u, v) => {
    const fx = u * cells, fz = v * cells, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const at = (a, b) => lattice[((iz + b) % cells) * cells + (ix + a) % cells];
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    return (at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sz) + (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sz;
  };
  for (let i = 0; i < size * size; i++) {
    const u = (i % size) / size, v = Math.floor(i / size) / size;
    data[i * 4] = Math.round((slopes[i * 2] / peak * .5 + .5) * 255);
    data[i * 4 + 1] = Math.round((slopes[i * 2 + 1] / peak * .5 + .5) * 255);
    data[i * 4 + 2] = Math.round((noise(u, v) * .65 + noise(u * 2 % 1, v * 2 % 1) * .35) * 255);
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

// Sky gradient and clouds as the sky dome draws them (cloud edges a little
// softer, as a rippled reflection blurs them), so the water reflects the sky
// it sits under.
const skyFunctions = `
  float hashSky(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noiseSky(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hashSky(i),hashSky(i+vec2(1,0)),f.x),mix(hashSky(i+vec2(0,1)),hashSky(i+vec2(1,1)),f.x),f.y);}
  vec3 skyAt(vec3 ray, bool clouds){
    float t=pow(max(ray.y,0.0),.65); vec3 c=mix(uSkyBottom,uSkyTop,t);
    if(clouds){
      vec2 p=ray.xz/max(ray.y,.05)*1.3;
      float n=noiseSky(p)*.5+noiseSky(p*2.1)*.25+noiseSky(p*4.2)*.125;
      c=mix(c,uCloudTone,smoothstep(.44,.74,n)*smoothstep(.025,.14,ray.y)*(1.0-smoothstep(.7,.95,ray.y))*.62);
    }
    return c;
  }`;

export function createWater(scene, fog = { uFogNear: { value: 350 }, uFogFar: { value: 1450 } }, streamCenter = { value: new THREE.Vector2() }, light = {}) {
  const patches = new Map();
  let wanted = new Map();
  const time = { value: 0 };
  // 1 on Medium and above: second wave layer, reflected clouds and sparkle.
  const detail = { value: 1 }, waves = { value: waveTexture() }, caustic = { value: new THREE.Vector4() }, ambient = { value: new THREE.Color(1, 1, 1) };
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    uniforms: { uTime: time, uStreamCenter: streamCenter, uFogNear: fog.uFogNear, uFogFar: fog.uFogFar, uDetail: detail, uWaves: waves,
      uShallow: { value: new THREE.Color('#4fb0a2') }, uDeep: { value: new THREE.Color('#1c4a5e') }, uSky: { value: new THREE.Color('#b9cdd0') },
      uSkyTop: { value: new THREE.Color(light.skyTop ?? '#729eaf') }, uSkyBottom: { value: new THREE.Color(light.skyBottom ?? '#b9cdd0') },
      uSunDir: { value: (light.sunDirection ?? new THREE.Vector3(-.52, .8, .36)).clone().normalize() }, uSunColor: { value: new THREE.Color(light.sunColor ?? '#fff0d2') }, uCloudTone: { value: new THREE.Color(.87, .9, .87) }, uLight: ambient },
    vertexShader: `attribute float bedDepth; attribute vec2 lakeUV;
      uniform float uTime; varying vec3 vWorld; varying float vDepth; varying vec2 vLake;
      #ifdef RIVER
      attribute vec3 river; varying vec3 vRiver;
      #endif
      attribute vec2 groundY; uniform vec2 uStreamCenter;
      void main(){
        vec3 p=position;
        float wave=sin(p.x*.11+p.z*.07+uTime*1.6)*.045+sin(p.x*-.06+p.z*.14-uTime*1.2)*.025;
        p.y+=wave*smoothstep(0.,1.,bedDepth);
        // Coarse terrain tiers barely dip into a small pond's basin. Ride just
        // above whichever tier is drawn here, so distant water is never buried
        // and never fills in suddenly as the finer terrain arrives.
        float d=distance(p.xz,uStreamCenter);
        p.y=mix(mix(p.y,max(p.y,groundY.x+.3),smoothstep(220.,360.,d)),max(p.y,groundY.y+.3),smoothstep(1150.,1450.,d));
        vWorld=p;vDepth=bedDepth;vLake=lakeUV;
        #ifdef RIVER
        vRiver=river;
        #endif
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
      }`,
    fragmentShader: `uniform float uTime,uFogNear,uFogFar,uDetail; uniform sampler2D uWaves; uniform vec2 uStreamCenter;
      #ifdef RIVER
      varying vec3 vRiver;
      #endif
      uniform vec3 uShallow,uDeep,uSky,uSkyTop,uSkyBottom,uSunDir,uSunColor,uCloudTone,uLight;
      varying vec3 vWorld; varying float vDepth; varying vec2 vLake;
      ${skyFunctions}
      void main(){
        if(vDepth<.015||length(vLake)>1.02)discard;
        vec2 p=vWorld.xz, drift=vec2(0.);
        #ifdef RIVER
        // Rivers come in two tiers, near chunks and far tiles, switching at a
        // fixed distance so they never overlap; their ripples drift downstream.
        float tierEdge=distance(p,uStreamCenter)-370.;
        if(vRiver.z<.5?tierEdge>0.:tierEdge<=0.)discard;
        drift=vRiver.xy*uTime;
        #endif
        float far=distance(cameraPosition,vWorld);
        // A broad swell plus two drifting wave-texture layers. Fine detail
        // fades with distance (mipmaps do the filtering), so wide water from
        // the air reads as open water, never as stripes.
        float a=p.x*.11+p.y*.07+uTime*1.6,b=p.x*-.06+p.y*.14-uTime*1.2;
        vec2 slope=vec2(-.045*cos(a)+.028*cos(b),-.03*cos(a)-.06*cos(b))*(1.-smoothstep(80.,380.,far)*.85);
        float near=1.-smoothstep(60.,480.,far), foamNoise=.5;
        if(far<900.){
          vec4 w1=texture2D(uWaves,(p-drift)*(1./34.)+uTime*vec2(.017,.011));
          slope+=(w1.xy*2.-1.)*.16*(.3+.7*near); foamNoise=w1.z;
          if(uDetail>.5){
            vec4 w2=texture2D(uWaves,mat2(.8,-.6,.6,.8)*(p-drift)*(1./11.)+uTime*vec2(-.031,.024));
            slope+=(w2.xy*2.-1.)*.09*near; foamNoise=mix(foamNoise,w2.z,.5);
          }
        }
        vec3 n=normalize(vec3(slope.x,1.,slope.y));
        vec3 view=normalize(cameraPosition-vWorld);
        // Reflection of the real sky, weighted by Schlick's Fresnel (water F0 ≈ 0.02).
        vec3 r=reflect(-view,n); r.y=max(r.y,.02);
        vec3 sky=skyAt(normalize(r),uDetail>.5);
        float fresnel=.02+.98*pow(1.-max(dot(n,view),0.),5.);
        // Light is absorbed with depth: clear turquoise edges, deep blue centre.
        // The water's own colour is lit by the scene: dim at night, warm at dusk.
        vec3 body=mix(uShallow,uDeep,1.-exp(-vDepth*.32))*uLight;
        vec3 color=mix(body,sky,clamp(fresnel*1.15,0.,1.));
        // Sun glitter from the scene's actual sun: a broad sheen plus fine sparkle.
        vec3 h=normalize(view+uSunDir); float nh=max(dot(n,h),0.);
        color+=uSunColor*(pow(nh,48.)*.1+pow(nh,320.)*(1.2+1.8*uDetail)*(.35+.65*near));
        // Shoreline foam: broken up by noise, lapping in and out over the shallows.
        float shore=1.-smoothstep(.05,.75,vDepth), lap=.5+.5*sin(uTime*1.3-vDepth*7.+foamNoise*4.);
        float foam=shore*smoothstep(.52,.78,foamNoise*.75+lap*.45)*near;
        color=mix(color,vec3(.93,.96,.94)*uLight,foam*.85);
        color=mix(color,uSky,smoothstep(uFogNear,uFogFar,far));
        // Close up, shallows show the bed. Further away the terrain beneath is
        // a coarse tier just under the surface (sand-coloured near shores), so
        // the water turns opaque instead of revealing it.
        float alpha=mix(.3,.97,1.-exp(-vDepth*.6));
        gl_FragColor=vec4(color,mix(max(alpha,foam),1.,smoothstep(200.,400.,far)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  // Rivers share the lakes' look and settings (one set of uniforms), with
  // ripples that drift downstream.
  const riverMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide, uniforms: material.uniforms,
    vertexShader: '#define RIVER\n' + material.vertexShader, fragmentShader: '#define RIVER\n' + material.fragmentShader });
  function riverMesh(data) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, size] of [['position', 3], ['bedDepth', 1], ['lakeUV', 2], ['groundY', 2], ['river', 3]]) geometry.setAttribute(name, new THREE.BufferAttribute(data[name], size));
    geometry.setIndex(new THREE.BufferAttribute(data.index, 1)); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, riverMaterial); mesh.name = 'River'; mesh.renderOrder = 1;
    return mesh;
  }
  function install(lake, data) {
    // The stream coordinator also rejects previous-world generations. This
    // guards late results for lakes left behind, and duplicate results.
    if (wanted.get(lake.id)?.level !== lake.level || patches.has(lake.id)) return false;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    geometry.setAttribute('bedDepth', new THREE.BufferAttribute(data.bedDepth, 1));
    geometry.setAttribute('lakeUV', new THREE.BufferAttribute(data.lakeUV, 2));
    geometry.setAttribute('groundY', new THREE.BufferAttribute(data.groundY, 2));
    geometry.setIndex(new THREE.BufferAttribute(data.index, 1)); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = lake.name; mesh.renderOrder = 1;
    scene.add(mesh); patches.set(lake.id, mesh); refreshDistant();
    return true;
  }
  function sync(world, x, z) {
    const lakes = world.lakesNear(x, z, 1000);
    wanted = new Map(lakes.map(l => [l.id, l]));
    let removed = false;
    for (const [id, mesh] of patches) if (!wanted.has(id)) { scene.remove(mesh); mesh.geometry.dispose(); patches.delete(id); removed = true; }
    if (removed) refreshDistant();
    return lakes.filter(lake => !patches.has(lake.id));
  }
  // Beyond the detailed patches, every lake and sea out to the far horizon is
  // one worker-built mesh. Each lake's part is dropped from the index while
  // its detailed patch is installed, so the two never overlap or leave a gap.
  const distant = new THREE.Mesh(new THREE.BufferGeometry(), material);
  distant.renderOrder = 1; distant.frustumCulled = false; distant.name = 'Distant water'; scene.add(distant);
  let distantRanges = [], distantIndex = null, distantCount = 0;
  function refreshDistant() {
    if (!distantIndex) return;
    const visible = distantRanges.filter(range => !patches.has(range.id));
    const index = new Uint32Array(visible.reduce((n, range) => n + range.count, 0));
    let at = 0;
    for (const range of visible) { index.set(distantIndex.subarray(range.start, range.start + range.count), at); at += range.count; }
    distant.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    distantCount = visible.length;
  }
  function installDistant(data, ranges) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    geometry.setAttribute('bedDepth', new THREE.BufferAttribute(data.bedDepth, 1));
    geometry.setAttribute('lakeUV', new THREE.BufferAttribute(data.lakeUV, 2));
    geometry.setAttribute('groundY', new THREE.BufferAttribute(data.groundY, 2));
    distant.geometry.dispose(); distant.geometry = geometry;
    distantRanges = ranges; distantIndex = data.index;
    refreshDistant();
  }
  // Wakes are instanced soft quads: foam streaks that spread sideways from the
  // bow (the boat outruns them, which draws the V of a Kelvin wake), churned
  // foam behind the stern, and rings for idling and splash-downs.
  const capacity = 220, ripples = [], dummy = new THREE.Object3D();
  const wakeGeometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const opacity = new Float32Array(capacity), kinds = new Float32Array(capacity);
  wakeGeometry.setAttribute('wakeOpacity', new THREE.InstancedBufferAttribute(opacity, 1).setUsage(THREE.DynamicDrawUsage));
  wakeGeometry.setAttribute('wakeKind', new THREE.InstancedBufferAttribute(kinds, 1).setUsage(THREE.DynamicDrawUsage));
  const wakeMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uWaves: waves, uLight: ambient },
    vertexShader: `attribute float wakeOpacity, wakeKind; varying float alpha, kind; varying vec2 vUv, vXZ;
      void main(){alpha=wakeOpacity;kind=wakeKind;vUv=position.xz;vec4 w=modelMatrix*instanceMatrix*vec4(position,1.);vXZ=w.xz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: `uniform sampler2D uWaves; uniform vec3 uLight; varying float alpha, kind; varying vec2 vUv, vXZ;
      void main(){
        float r=length(vUv), shape;
        if(kind<.5) shape=exp(-vUv.x*vUv.x*3.)*(1.-smoothstep(.3,1.,abs(vUv.y)));    // streak
        else if(kind<1.5) shape=1.-smoothstep(.25,1.,r);                              // churned foam
        else shape=exp(-pow((r-.86)/.075,2.));                                          // ring
        float foam=texture2D(uWaves,vXZ*.11).z;
        float a=alpha*shape*mix(.15,1.,smoothstep(.3,.75,foam+shape*.2));
        if(a<.004)discard;
        gl_FragColor=vec4(vec3(.9,.95,.93)*uLight,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const wakes = new THREE.InstancedMesh(wakeGeometry, wakeMaterial, capacity); wakes.frustumCulled = false; wakes.count = 0; wakes.name = 'Wakes'; wakes.renderOrder = 2; scene.add(wakes);
  wakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const life = [2.6, 2.2, 2.4], spread = Math.tan(19.5 * Math.PI / 180);
  function emit(ripple) { if (ripples.length >= capacity) ripples.shift(); ripples.push(ripple); }
  let emission = 0, lastY = null, airborne = 0, causticCheck = 0, wasWet = false;
  const splashes = []; // { x, z, power } for the sound, drained each frame
  function update(world, pose, dt) {
    time.value = pose.time; emission += dt;
    const water = world.waterAt(pose.x, pose.z);
    // Height above the water while airborne, so the landing can splash.
    const fall = lastY === null || dt <= 0 ? 0 : (lastY - pose.y) / dt; lastY = pose.y;
    if (!water || pose.y > water.level + .6) airborne = Math.max(airborne, water ? pose.y - water.level : 1.5);
    const s = Math.sin(pose.heading), c = Math.cos(pose.heading), speed = Math.abs(pose.speed);
    const wet = Boolean(water && pose.y < water.level + .2);
    if (wet) {
      if (airborne > 1.1 || (airborne > .6 && fall > 4)) {
        const power = Math.min(1, .45 + airborne * .12 + fall * .03);
        splashes.push({ x: pose.x, z: pose.z, power });
        for (let k = 0; k < 3; k++) emit({ kind: 2, x: pose.x, z: pose.z, level: water.level, age: -k * .14, heading: 0, power, grow: 2.6 + k * 1.3 + power * 2, base: 1.2 + k * .6 });
        emit({ kind: 1, x: pose.x, z: pose.z, level: water.level, age: 0, heading: 0, power, grow: 1.4, base: 2.4 });
      }
      // Driving in from the shore at speed throws up a smaller splash.
      else if (!wasWet && speed > 4) splashes.push({ x: pose.x, z: pose.z, power: Math.min(.6, speed / 40) });
      airborne = 0;
      if (emission >= (speed > 1 ? .07 : .6)) {
        emission = 0;
        const power = Math.min(1, .15 + speed / 16), half = 1 + pose.transform * .5;
        if (speed > 1.5) {
          // Bow streaks, angled along the arms of the V and drifting outward.
          for (const side of [-1, 1]) {
            const arm = pose.heading + Math.PI - side * .34;
            emit({ kind: 0, x: pose.x + s * .8 + c * side * half, z: pose.z + c * .8 - s * side * half, level: water.level, age: 0, heading: arm, power,
              vx: c * side * speed * spread, vz: -s * side * speed * spread, grow: .8, base: .45, length: 1.2 + speed * .05 });
          }
          emit({ kind: 1, x: pose.x - s * 2.4 + (Math.random() - .5) * .6, z: pose.z - c * 2.4 + (Math.random() - .5) * .6, level: water.level, age: 0, heading: Math.random() * 6.3, power: power * .8, grow: .9 + speed * .03, base: .7 });
        } else {
          emit({ kind: 2, x: pose.x, z: pose.z, level: water.level, age: 0, heading: 0, power: .35, grow: 1.2, base: 2.2 });
        }
      }
    }
    wasWet = wet;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]; r.age += dt;
      if (r.vx && r.age > 0) { r.x += r.vx * dt; r.z += r.vz * dt; }
      if (r.age > life[r.kind]) ripples.splice(i, 1);
    }
    ripples.forEach((r, i) => {
      const age = Math.max(r.age, 0), t = age / life[r.kind];
      dummy.position.set(r.x, r.level + .06 + waterWave(r.x, r.z, pose.time), r.z);
      dummy.rotation.set(0, r.heading, 0);
      const size = r.base + age * r.grow;
      dummy.scale.set(size, 1, r.kind === 0 ? r.length + age * .8 : size); dummy.updateMatrix();
      wakes.setMatrixAt(i, dummy.matrix); kinds[i] = r.kind;
      opacity[i] = r.age < 0 ? 0 : r.power * Math.min(1, age * 8) * (1 - t) * (1 - t * .4) * (r.kind === 0 ? .32 : r.kind === 1 ? .5 : .6);
    });
    wakes.count = ripples.length;
    if (ripples.length) { wakes.instanceMatrix.needsUpdate = true; wakeGeometry.attributes.wakeOpacity.needsUpdate = true; wakeGeometry.attributes.wakeKind.needsUpdate = true; }
    // Caustics follow the lake nearest the car.
    if ((causticCheck -= dt) <= 0) {
      causticCheck = .25;
      let best = null, bestDistance = Infinity;
      if (detail.value > .5) for (const lake of world.lakesNear?.(pose.x, pose.z, 90) ?? []) {
        const d = Math.hypot(lake.x - pose.x, lake.z - pose.z) - lakeExtent(lake);
        if (d < bestDistance) { best = lake; bestDistance = d; }
      }
      caustic.value.set(best?.x ?? 0, best?.z ?? 0, best ? lakeExtent(best) * 1.05 : 0, best?.level ?? 0);
    }
  }
  function clear() {
    for (const mesh of patches.values()) { scene.remove(mesh); mesh.geometry.dispose(); }
    patches.clear(); wanted.clear(); ripples.length = 0; wakes.count = 0; emission = 0; lastY = null; airborne = 0; causticCheck = 0; wasWet = false; splashes.length = 0; caustic.value.set(0, 0, 0, 0);
    distant.geometry.dispose(); distant.geometry = new THREE.BufferGeometry(); distantRanges = []; distantIndex = null; distantCount = 0;
  }
  // Weather: the reflected sky, the fade colour and the sun's glitter follow
  // the overcast sky. Colours are copied, so callers can reuse theirs.
  const baseSun = material.uniforms.uSunColor.value.clone();
  // direction and color (optional): the key light (sun or moon) for glitter;
  // clouds: the reflected clouds' colour, which follows the time of day.
  // light: the scene's light on the water itself (white by day, dark at night).
  function setSky(top, bottom, sun, direction, color, clouds, light) {
    const u = material.uniforms;
    if (light) ambient.value.copy(light);
    u.uSkyTop.value.copy(top); u.uSkyBottom.value.copy(bottom); u.uSky.value.copy(bottom);
    u.uSunColor.value.copy(color ?? baseSun).multiplyScalar(sun);
    if (direction) u.uSunDir.value.copy(direction).normalize();
    if (clouds) u.uCloudTone.value.copy(clouds);
  }
  const setDetail = on => { detail.value = on ? 1 : 0; causticCheck = 0; if (!on) caustic.value.z = 0; };
  return { sync, install, update, clear, installDistant, setDetail, setSky, riverMesh, riverWarmup: new THREE.Mesh(new THREE.BufferGeometry(), riverMaterial), drainSplashes: () => splashes.splice(0), causticUniforms: { uTime: time, uCausticLake: caustic }, get distantCount() { return distantCount; }, wants: id => wanted.has(id), get ready() { return patches.size === wanted.size; },
    get count() { return patches.size; }, get wakeCount() { return ripples.length; } };
}
