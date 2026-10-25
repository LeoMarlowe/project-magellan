import { ShaderChunk, Mesh } from 'three';

let installed = false;
// Install before any materials compile. Apply at the shadow receiver so terrain,
// cars and instanced props share the transition, including on sloping ground.
//
// The sun has up to two shadow maps: the first directional shadow is a sharp
// 96 m map around the car, the second (when enabled) a coarse, wider map whose
// light contributes no light of its own. Near the car the sharp map decides;
// toward its edge the coarse one takes over, and it fades out at its own edge,
// so trees and rocks cast shadows from much further away without softening
// the car's. No extra lighting pass: only the second map's depth render.
// A third map (when enabled) holds the vehicle alone, tight around it; the
// sun's light takes the darker of it and the other two.
export function installSunShadowFade() {
  if (installed) return;
  installed = true;
  ShaderChunk.shadowmap_pars_fragment += `
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
    // Leave a small fully lit guard band before clipping, then fade over about
    // 28% of the map's half-width, with full strength in the central area.
    float sunShadowCoverage(vec4 shadowCoord) {
      vec3 coord = shadowCoord.xyz / shadowCoord.w;
      vec3 edge = min(coord, vec3(1.0) - coord);
      return smoothstep(0.02, 0.3, min(edge.x, edge.y)) * smoothstep(0.02, 0.12, edge.z);
    }
    float getFadedSunShadow(sampler2D shadowMap, vec2 mapSize, float bias, float radius, vec4 shadowCoord) {
      return mix(1.0, getShadow(shadowMap, mapSize, bias, radius, shadowCoord), sunShadowCoverage(shadowCoord));
    }
    #endif
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 2
    // The vehicle's own map is full strength right up to its edge.
    float getVehicleShadow(sampler2D map, vec2 size, float bias, float radius, vec4 shadowCoord) {
      vec3 coord = shadowCoord.xyz / shadowCoord.w;
      vec3 edge = min(coord, vec3(1.0) - coord);
      return mix(1.0, getShadow(map, size, bias, radius, shadowCoord), smoothstep(0.0, 0.03, min(min(edge.x, edge.y), edge.z)));
    }
    #endif
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 1
    float getCascadedSunShadow(sampler2D nearMap, vec2 nearSize, float nearBias, float nearRadius, vec4 nearCoord,
                               sampler2D farMap, vec2 farSize, float farBias, float farRadius, vec4 farCoord) {
      float nearCoverage = sunShadowCoverage(nearCoord);
      if (nearCoverage >= 1.0) return getShadow(nearMap, nearSize, nearBias, nearRadius, nearCoord);
      // Distant shadows are a little lighter, as haze would make them.
      float farShadow = mix(1.0, getShadow(farMap, farSize, farBias, farRadius, farCoord), sunShadowCoverage(farCoord) * 0.85);
      if (nearCoverage <= 0.0) return farShadow;
      return mix(farShadow, getShadow(nearMap, nearSize, nearBias, nearRadius, nearCoord), nearCoverage);
    }
    #endif
  `;
  const call = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
  const shadow = n => `directionalShadowMap[ ${n} ], directionalLightShadows[ ${n} ].shadowMapSize, directionalLightShadows[ ${n} ].shadowBias, directionalLightShadows[ ${n} ].shadowRadius, vDirectionalShadowCoord[ ${n} ]`;
  if (!ShaderChunk.lights_fragment_begin.includes(call)) throw new Error('Unexpected three.js directional shadow chunk');
  ShaderChunk.lights_fragment_begin = ShaderChunk.lights_fragment_begin.replace(call, `
		#if NUM_DIR_LIGHT_SHADOWS > 2
		#if UNROLLED_LOOP_INDEX == 0
		directLight.color *= ( directLight.visible && receiveShadow ) ? min( getCascadedSunShadow( ${shadow(0)}, ${shadow(1)} ), getVehicleShadow( ${shadow(2)} ) ) : 1.0;
		#endif
		#elif NUM_DIR_LIGHT_SHADOWS > 1
		#if UNROLLED_LOOP_INDEX == 0
		directLight.color *= ( directLight.visible && receiveShadow ) ? getCascadedSunShadow( ${shadow(0)}, ${shadow(1)} ) : 1.0;
		#endif
		#else
		${call.replace('getShadow(', 'getFadedSunShadow(')}
		#endif`);
  ShaderChunk.shadowmask_pars_fragment = ShaderChunk.shadowmask_pars_fragment.replaceAll('getShadow( directionalShadowMap', 'getFadedSunShadow( directionalShadowMap');
}

// The vehicle's shadow map: drawn from a small box that moves with the car,
// not snapped to texels. In the 96 m sun map each texel is about 5 cm (a few
// pixels at chase distance), so as the car moved across that fixed grid its
// shadow edges stepped and crawled, and the soft filter blurred them; here it
// meets the same texels every frame, a centimetre each. Parts marked
// userData.vehicle draw only into this map (while it's on), everything else
// only into the sun's: three.js has no per-light layers, so the hooks empty
// the draw for the wrong map and restore it after.
export function separateVehicleShadow(vehicleCamera) {
  let active = false;
  const emptied = new Map();
  Mesh.prototype.onBeforeShadow = function (renderer, object, camera, shadowCamera, geometry) {
    if (!active || (shadowCamera === vehicleCamera) === Boolean(object.userData.vehicle)) return;
    emptied.set(geometry, geometry.drawRange.count); geometry.drawRange.count = 0;
  };
  Mesh.prototype.onAfterShadow = function (renderer, object, camera, shadowCamera, geometry) {
    if (emptied.has(geometry)) { geometry.drawRange.count = emptied.get(geometry); emptied.delete(geometry); }
  };
  return { set active(on) { active = on; }, get active() { return active; } };
}
