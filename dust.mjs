import * as THREE from 'three';

// Dust thrown up behind the wheels on dirt tracks: soft puffs that billow,
// drift and thin out over a couple of seconds. One draw call and a fixed
// pool of puffs, recycled oldest first.
export function createDust(scene, capacity = 240) {
  const geometry = new THREE.BufferGeometry();
  const position = new Float32Array(capacity * 3), size = new Float32Array(capacity), alpha = new Float32Array(capacity), tint = new Float32Array(capacity * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: { value: 600 }, uLight: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 tint; uniform float uScale; varying float vAlpha; varying vec3 vTint;
      void main(){ vec4 view=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*view; gl_PointSize=size*uScale/max(1.0,-view.z); vAlpha=alpha; vTint=tint; }`,
    fragmentShader: `uniform vec3 uLight; varying float vAlpha; varying vec3 vTint;
      void main(){ vec2 c=gl_PointCoord-.5; float r=dot(c,c)*4.0; if(r>1.0) discard; gl_FragColor=vec4(vTint*uLight,vAlpha*(1.0-r)*(1.0-r)); }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; points.renderOrder = 2; points.name = 'Dust';
  scene.add(points);
  const puffs = [];
  let carry = 0, next = 0;
  function add(puff) {
    if (puffs.length < capacity) puffs.push(puff); else puffs[next % capacity] = puff;
    next++;
  }
  // A puff placed by another effect (the Roadster's thruster vapour).
  function puff(x, y, z, vx, vy, vz, life, grow, color) {
    add({ x, y, z, vx, vy, vz, age: 0, life, grow, r: color.r, g: color.g, b: color.b });
  }
  // Each frame: car is the vehicle state; raising says whether its wheels
  // are on a dirt track and dry; color is the dust's colour; pixels the
  // screen height (so puffs keep their size at any resolution).
  function update(dt, car, raising, color, pixels, fov) {
    material.uniforms.uScale.value = pixels / (2 * Math.tan(fov * Math.PI / 360));
    const speed = Math.hypot(car.vx, car.vz);
    if (raising && car.grounded && speed > 4) {
      carry += dt * Math.min(60, speed * 1.4);
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading), rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
      while (carry >= 1) {
        carry--;
        const side = next % 2 ? 1 : -1, jitter = ((next * 7919) % 100) / 100 - .5;
        add({ x: car.x - fx * 1.5 + rx * side * .85, y: car.y + .25, z: car.z - fz * 1.5 + rz * side * .85,
          vx: car.vx * .25 + rx * side * 1.5 + jitter, vy: .8 + Math.abs(jitter) * 1.2, vz: car.vz * .25 + rz * side * 1.5 - jitter, age: 0, life: 1.4 + Math.abs(jitter), grow: .8 + speed * .012, r: color.r, g: color.g, b: color.b });
      }
    } else carry = 0;
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i]; p.age += dt;
      const drag = Math.exp(-2.2 * dt);
      p.vx *= drag; p.vz *= drag; p.vy *= Math.exp(-1.2 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = Math.min(1, p.age / p.life);
      position[i * 3] = p.x; position[i * 3 + 1] = p.y; position[i * 3 + 2] = p.z;
      size[i] = .6 + p.grow * 1.9 * Math.sqrt(t);
      alpha[i] = t >= 1 ? 0 : .24 * Math.min(1, p.age * 8) * (1 - t);
      tint[i * 3] = p.r; tint[i * 3 + 1] = p.g; tint[i * 3 + 2] = p.b;
    }
    geometry.setDrawRange(0, puffs.length);
    for (const name of ['position', 'size', 'alpha', 'tint']) geometry.attributes[name].needsUpdate = true;
  }
  return { update, puff, setLight: color => material.uniforms.uLight.value.copy(color), clear() { puffs.length = 0; carry = 0; geometry.setDrawRange(0, 0); }, get count() { return puffs.filter(p => p.age < p.life).length; } };
}
