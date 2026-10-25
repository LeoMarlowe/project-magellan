import * as THREE from 'three';

// The Roadster's cold-gas exhaust. Nothing burns: each nozzle throws a pale,
// widening jet of cold gas that fogs the air, flickering faintly, and where
// the lift jets reach the ground or water they raise billowing vapour.
// Plumes hang from the asset's Exhaust_* nodes and are hidden while idle.
const LENGTH = { rear: 3.6, lift: 2.6, yawL: 1.4, yawR: 1.4 }; // m at full thrust
const plumeShader = {
  uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } },
  vertexShader: `varying float vAlong; varying vec3 vNormal, vView;
    void main(){ vAlong=-position.y; vec4 view=modelViewMatrix*vec4(position,1.); vView=-view.xyz; vNormal=normalMatrix*normal; gl_Position=projectionMatrix*view; }`,
  fragmentShader: `uniform float uOpacity, uTime; uniform vec3 uLight; varying float vAlong; varying vec3 vNormal, vView;
    void main(){
      float facing=abs(dot(normalize(vNormal),normalize(vView)));
      float pulse=.82+.18*sin(vAlong*34.-uTime*70.);
      float a=uOpacity*pow(1.-clamp(vAlong,0.,1.),1.4)*smoothstep(.05,.7,facing)*pulse;
      gl_FragColor=vec4(mix(vec3(1.15,1.18,1.22),vec3(.82,.87,.92),sqrt(clamp(vAlong,0.,1.)))*uLight,a);
    }`,
};
export function createThrusterPlumes(nozzles) {
  // A unit open cone: radius 1 at the mouth (origin), 4.2 at the far end, one
  // unit long down -Y; each plume scales it to its nozzle and thrust.
  const geometry = new THREE.CylinderGeometry(1, 4.2, 1, 14, 1, true).translate(0, -.5, 0);
  const down = new THREE.Vector3(0, -1, 0), groups = {};
  for (const [group, list] of Object.entries(nozzles)) {
    const material = new THREE.ShaderMaterial({ ...plumeShader, uniforms: THREE.UniformsUtils.clone(plumeShader.uniforms), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const plumes = list.map(({ node, thrust, radius }) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'Plume_' + node.name; mesh.quaternion.setFromUnitVectors(down, thrust); mesh.renderOrder = 3;
      mesh.visible = false; mesh.castShadow = mesh.receiveShadow = false; mesh.userData.radius = radius;
      node.add(mesh); return mesh;
    });
    groups[group] = { material, plumes, power: 0 };
  }
  return {
    groups,
    // power: each group's thrust 0..1; eases in and out over a few frames.
    update(power, dt, time, light) {
      for (const [name, group] of Object.entries(groups)) {
        group.power += ((power[name] ?? 0) - group.power) * (1 - Math.exp(-dt * ((power[name] ?? 0) > group.power ? 30 : 12)));
        const shown = group.power > .02, flicker = 1 + Math.sin(time * 53 + name.length) * .05;
        group.material.uniforms.uOpacity.value = Math.min(.85, group.power);
        group.material.uniforms.uTime.value = time;
        if (light) group.material.uniforms.uLight.value.copy(light);
        for (const mesh of group.plumes) {
          mesh.visible = shown;
          const r = mesh.userData.radius * (.9 + group.power * .25);
          mesh.scale.set(r, LENGTH[name] * (.25 + .75 * group.power) * flicker, r);
        }
      }
    },
    get visible() { return Object.values(groups).reduce((n, g) => n + g.plumes.filter(m => m.visible).length, 0); },
  };
}

// Vapour: puffs into a dust pool where the lift jets hit the ground or water
// (spreading outward), spray from the cushion skimming water, and a thin
// trail behind the boost nozzles.
const at = new THREE.Vector3(), vapourColor = new THREE.Color(.92, .94, .96), sprayColor = new THREE.Color(.86, .92, .95);
export function createVapour(pool) {
  let carry = 0, seed = 1;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  return function emit(dt, car, nozzles, surfaceAt) {
    const speed = Math.hypot(car.vx, car.vz), height = car.y - car.groundY;
    const near = car.lift * (1 - Math.min(1, height / 7)), skim = car.overWater && height < .6 ? .35 + Math.min(1, speed / 30) * .65 : 0;
    carry += dt * (near * 70 + skim * 45 + car.boost * 55);
    while (carry >= 1) {
      carry--;
      const kind = random() * (near * 70 + skim * 45 + car.boost * 55);
      if (kind < near * 70) {
        const nozzle = nozzles.lift[Math.floor(random() * nozzles.lift.length)];
        nozzle.node.getWorldPosition(at);
        const a = random() * Math.PI * 2, out = 3 + random() * 4;
        pool.puff(at.x, surfaceAt(at.x, at.z) + .3, at.z, Math.cos(a) * out + car.vx * .3, .6 + random(), Math.sin(a) * out + car.vz * .3, 1.2 + random() * .8, 1.4, vapourColor);
      } else if (kind < near * 70 + skim * 45) {
        const back = 1.2 + random() * 1.4, side = (random() - .5) * 2.2, fx = Math.sin(car.heading), fz = Math.cos(car.heading);
        const x = car.x - fx * back + fz * side, z = car.z - fz * back - fx * side;
        pool.puff(x, car.y - .2, z, car.vx * .45 + fz * side * 1.5, .8 + random() * 1.2, car.vz * .45 - fx * side * 1.5, .7 + random() * .6, .8 + speed * .02, sprayColor);
      } else {
        const nozzle = nozzles.rear[Math.floor(random() * nozzles.rear.length)];
        nozzle.node.getWorldPosition(at);
        const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
        pool.puff(at.x - fx * 2.5, at.y + .1, at.z - fz * 2.5, car.vx * .7 - fx * 4, .3 + random() * .4, car.vz * .7 - fz * 4, .6 + random() * .5, 1.1, vapourColor);
      }
    }
  };
}
