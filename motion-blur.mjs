import * as THREE from 'three';

// Camera motion blur. At driving and flying speeds things near the camera
// cross the screen hundreds of pixels a frame; drawn sharp at 60 fps they
// read as a row of separate copies flicking past. Here the scene is drawn
// into a target of its own (exactly as on screen: tone mapped, sRGB, 4×
// multisampled), and each pixel is smeared along how far the point it shows
// moved on screen since the last frame, worked out from its depth and the
// camera's last position (a half-frame shutter, like a film camera's).
//
// Smearing each pixel only along its own motion would leave a fast, thin post
// as a faint ghost of itself. The reconstruction filter of McGuire et al.
// (2012, "A Reconstruction Filter for Plausible Motion Blur") instead blurs
// along the fastest motion nearby (the largest in each tile, spread to the
// tiles around it), and weighs each sample by which of the two points is in
// front, so the post's streak covers its whole path and nearer things never
// smear over farther ones.
//
// The car moves with the camera and stays sharp: any point inside its box
// (the plane's, wings and all) is taken as not moving.
//
// With the blur off the scene still comes through the target, copied to the
// screen as it is: the target is the scene's multisampling, so the screen
// itself needn't be (a second multisampled pass there cost about a frame a
// second at full speed).

const SAMPLES = 15;      // along the blur, per pixel, at most (fewer for a short blur)
const MAX_TILE = 96;     // the longest tile side the shaders loop over, in pixels
const SHUTTER = .5;      // the share of the frame's motion each frame shows

const motionChunk = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uInvViewProj, uPrevViewProj, uCarInverse;
  uniform vec3 uCarMin, uCarMax;
  uniform float uCarMask, uShutter, uMaxBlur, uNear, uFar;
  uniform vec2 uResolution;
  // The point seen at uv (with this depth), and how far it moved on screen
  // since the last frame, in pixels: scaled by the shutter and capped at the
  // blur radius. The car moves with the camera.
  vec3 worldAt(vec2 uv, float depth) {
    vec4 p = uInvViewProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  vec2 motionAt(vec2 uv, float depth) {
    vec3 world = worldAt(uv, depth);
    if (uCarMask > .5) {
      vec3 local = (uCarInverse * vec4(world, 1.0)).xyz;
      if (all(greaterThan(local, uCarMin)) && all(lessThan(local, uCarMax))) return vec2(0.0);
    }
    vec4 before = uPrevViewProj * vec4(world, 1.0);
    if (before.w <= 0.0) return vec2(0.0);
    vec2 v = (uv - (before.xy / before.w * .5 + .5)) * uResolution * uShutter;
    float speed = length(v);
    return speed > uMaxBlur ? v * (uMaxBlur / speed) : v;
  }
  float distanceAt(float depth) {
    float z = depth * 2.0 - 1.0;
    return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
  }`;

const vertexShader = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Each pixel's motion and distance, worked out once for the passes after.
const motionShader = /* glsl */ `
  ${motionChunk}
  void main() {
    vec2 px = gl_FragCoord.xy;
    float depth = texelFetch(tDepth, ivec2(px), 0).r;
    gl_FragColor = vec4(motionAt(px / uResolution, depth), distanceAt(depth), 1.0);
  }`;

// The fastest motion in each tile's row of pixels (one texel per tile across,
// per pixel row)...
const rowShader = /* glsl */ `
  uniform sampler2D tMotion;
  uniform float uTile;
  uniform vec2 uResolution;
  void main() {
    int tile = int(uTile), x0 = int(gl_FragCoord.x) * tile, y = int(gl_FragCoord.y), width = int(uResolution.x);
    vec2 best = vec2(0.0);
    for (int i = 0; i < ${MAX_TILE}; i++) {
      int x = x0 + i;
      if (i >= tile || x >= width) break;
      vec2 v = texelFetch(tMotion, ivec2(x, y), 0).xy;
      if (dot(v, v) > dot(best, best)) best = v;
    }
    gl_FragColor = vec4(best, 0.0, 1.0);
  }`;

// ...then down each tile's column of those: the fastest in the tile...
const tileShader = /* glsl */ `
  uniform sampler2D tRows;
  uniform float uTile;
  uniform vec2 uResolution;
  void main() {
    int tile = int(uTile), x = int(gl_FragCoord.x), y0 = int(gl_FragCoord.y) * tile, height = int(uResolution.y);
    vec2 best = vec2(0.0);
    for (int i = 0; i < ${MAX_TILE}; i++) {
      int y = y0 + i;
      if (i >= tile || y >= height) break;
      vec2 v = texelFetch(tRows, ivec2(x, y), 0).xy;
      if (dot(v, v) > dot(best, best)) best = v;
    }
    gl_FragColor = vec4(best, 0.0, 1.0);
  }`;

// ...and the fastest among it and the eight tiles around it, so a streak can
// reach into the next tile.
const neighbourShader = /* glsl */ `
  uniform sampler2D tTiles;
  uniform vec2 uTiles;
  void main() {
    ivec2 at = ivec2(gl_FragCoord.xy), last = ivec2(uTiles) - 1;
    vec2 best = vec2(0.0);
    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
      vec2 v = texelFetch(tTiles, clamp(at + ivec2(dx, dy), ivec2(0), last), 0).xy;
      if (dot(v, v) > dot(best, best)) best = v;
    }
    gl_FragColor = vec4(best, 0.0, 1.0);
  }`;

// With the blur off: the scene as it is.
const copyShader = /* glsl */ `
  uniform sampler2D tColor;
  void main() { gl_FragColor = texelFetch(tColor, ivec2(gl_FragCoord.xy), 0); }`;

// The blur itself, drawn to the screen.
const blurShader = /* glsl */ `
  uniform sampler2D tColor, tMotion, tNeighbours;
  uniform float uTile;
  uniform vec2 uResolution;
  float cone(float d, float speed) { return clamp(1.0 - d / speed, 0.0, 1.0); }
  float cylinder(float d, float speed) { return 1.0 - smoothstep(.95 * speed, 1.05 * speed, d); }
  void main() {
    vec2 px = gl_FragCoord.xy, uv = px / uResolution;
    vec4 color = texture2D(tColor, uv);
    vec2 reach = texelFetch(tNeighbours, ivec2(px / uTile), 0).xy;
    float reachLength = length(reach);
    if (reachLength < .5) { gl_FragColor = color; return; }
    vec4 here = texelFetch(tMotion, ivec2(px), 0);
    float depthX = here.z, speedX = max(length(here.xy), .5);
    // Within a few per cent of each other's distance, two points blur together.
    float soft = max(.3, depthX * .04);
    float weight = 1.0 / speedX;
    vec4 sum = color * weight;
    // A different offset along the blur for each pixel, so the samples blend
    // into a smooth streak rather than steps.
    float jitter = fract(52.9829189 * fract(dot(px, vec2(.06711056, .00583715)))) - .5;
    // About one sample every 6 pixels along the blur's full length.
    int count = int(clamp(ceil(reachLength / 3.0), 4.0, ${SAMPLES}.0));
    for (int i = 0; i < ${SAMPLES}; i++) {
      if (i >= count) break;
      float t = mix(-1.0, 1.0, (float(i) + jitter + 1.0) / float(count + 1));
      vec2 offset = reach * t, pY = clamp(px + offset, vec2(.5), uResolution - .5), uvY = pY / uResolution;
      vec4 there = texelFetch(tMotion, ivec2(pY), 0);
      float depthY = there.z, speedY = max(length(there.xy), .5), d = length(offset);
      // A nearer sample shows if its own blur reaches this pixel; a farther
      // one if this pixel's blur uncovers it; both blurred, they mix.
      float front = clamp(1.0 - (depthY - depthX) / soft, 0.0, 1.0), behind = clamp(1.0 - (depthX - depthY) / soft, 0.0, 1.0);
      float w = front * cone(d, speedY) + behind * cone(d, speedX) + cylinder(d, speedY) * cylinder(d, speedX) * 2.0;
      weight += w; sum += w * texture2D(tColor, uvY);
    }
    gl_FragColor = sum / weight;
  }`;

export function createMotionBlur(renderer) {
  // The scene, drawn as to the screen: three.js tone maps and sRGB-encodes
  // only for the screen and XR targets, so this target counts as one. Its
  // colours stay 8-bit sRGB values, as on screen (no hardware conversion).
  const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, depthTexture: new THREE.DepthTexture(1, 1) });
  target.isXRRenderTarget = true;
  target.texture.internalFormat = 'RGBA8';
  target.depthTexture.minFilter = target.depthTexture.magFilter = THREE.NearestFilter;
  const motionTarget = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const motion = motionTarget(), rows = motionTarget(), tiles = motionTarget(), neighbours = motionTarget();
  const size = new THREE.Vector2(), viewProj = new THREE.Matrix4(), carInverse = new THREE.Matrix4(), toLocal = new THREE.Matrix4();
  const carBox = new THREE.Box3(), corner = new THREE.Vector3();
  const uniforms = {
    tColor: { value: target.texture }, tDepth: { value: target.depthTexture }, tMotion: { value: motion.texture }, tRows: { value: rows.texture }, tTiles: { value: tiles.texture }, tNeighbours: { value: neighbours.texture },
    uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() }, uCarInverse: { value: carInverse },
    uCarMin: { value: new THREE.Vector3() }, uCarMax: { value: new THREE.Vector3() }, uCarMask: { value: 0 },
    uShutter: { value: SHUTTER }, uMaxBlur: { value: 1 }, uNear: { value: .1 }, uFar: { value: 1000 },
    uResolution: { value: new THREE.Vector2(1, 1) }, uTile: { value: 1 }, uTiles: { value: new THREE.Vector2(1, 1) },
  };
  const pass = fragmentShader => new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false, toneMapped: false }));
  const passes = { copy: pass(copyShader), motion: pass(motionShader), rows: pass(rowShader), tiles: pass(tileShader), neighbours: pass(neighbourShader), blur: pass(blurShader) };
  const quad = new THREE.Scene(), quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  for (const mesh of Object.values(passes)) { mesh.frustumCulled = false; quad.add(mesh); }
  let moved = false, drawing = false;
  const stats = { calls: 0, triangles: 0 };
  function draw(name, into) {
    for (const [key, mesh] of Object.entries(passes)) mesh.visible = key === name;
    renderer.setRenderTarget(into); renderer.render(quad, quadCamera);
  }
  function resize() {
    renderer.getDrawingBufferSize(size);
    if (size.x === uniforms.uResolution.value.x && size.y === uniforms.uResolution.value.y) return;
    // The blur reaches about 2.5% of the screen's width either way (48 px
    // across a 1920 px screen); a tile is as wide as the blur's reach.
    const tile = Math.min(MAX_TILE, Math.max(8, Math.round(size.x * .025))), across = Math.ceil(size.x / tile), down = Math.ceil(size.y / tile);
    target.setSize(size.x, size.y); motion.setSize(size.x, size.y); rows.setSize(across, size.y); tiles.setSize(across, down); neighbours.setSize(across, down);
    uniforms.uResolution.value.copy(size); uniforms.uTile.value = tile; uniforms.uMaxBlur.value = tile; uniforms.uTiles.value.set(across, down);
  }
  // The car's (or plane's) box in its own frame, from the meshes drawn now,
  // with its floor a little above the ground it stands on (so the ground
  // around the wheels still blurs).
  function measureCar(car) {
    carInverse.copy(car.matrixWorld).invert(); carBox.makeEmpty();
    car.traverseVisible(o => {
      if (!o.isMesh) return;
      const box = o.geometry.boundingBox ?? (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
      toLocal.multiplyMatrices(carInverse, o.matrixWorld);
      for (let i = 0; i < 8; i++) carBox.expandByPoint(corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(toLocal));
    });
    if (carBox.isEmpty()) return false;
    uniforms.uCarMin.value.copy(carBox.min).subScalar(.08); uniforms.uCarMin.value.y = carBox.min.y + .3;
    uniforms.uCarMax.value.copy(carBox.max).addScalar(.08);
    return true;
  }
  return {
    // Whether the scene is being drawn into the blur's target right now.
    get drawing() { return drawing; },
    // The scene's own draw calls and triangles (the passes after it don't count).
    stats,
    // The next frame starts afresh: after a cut, a reset or a pause.
    reset() { moved = false; },
    // Draw the scene, through the blur or (blur false) as it is. car: the
    // vehicle, kept sharp, or null.
    render(scene, camera, car, blur = true) {
      resize();
      drawing = true;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      drawing = false;
      stats.calls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles;
      if (!blur) { draw('copy', null); moved = false; return; }
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      uniforms.uInvViewProj.value.copy(viewProj).invert();
      if (!moved) uniforms.uPrevViewProj.value.copy(viewProj);
      uniforms.uNear.value = camera.near; uniforms.uFar.value = camera.far;
      uniforms.uCarMask.value = car && measureCar(car) ? 1 : 0;
      draw('motion', motion); draw('rows', rows); draw('tiles', tiles); draw('neighbours', neighbours); draw('blur', null);
      uniforms.uPrevViewProj.value.copy(viewProj); moved = true;
    },
    // Build the passes' shaders ahead of their first use (each for the
    // target it draws into).
    compile() {
      resize();
      for (const [name, into] of [['copy', null], ['motion', motion], ['rows', rows], ['tiles', tiles], ['neighbours', neighbours], ['blur', null]]) {
        for (const [key, mesh] of Object.entries(passes)) mesh.visible = key === name;
        renderer.setRenderTarget(into); renderer.compile(quad, quadCamera);
      }
      renderer.setRenderTarget(null);
    },
  };
}
