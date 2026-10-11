import * as THREE from 'three';

// Global colour grade, applied as three's CustomToneMapping. Slight
// desaturation, cool shadows / warm highlights, a touch of contrast and a
// gentle shoulder: a grounded RPG look instead of candy colours. Renderers
// opt in with renderer.toneMapping = THREE.CustomToneMapping.
const HOOK = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  HOOK,
  `
vec3 CustomToneMapping( vec3 color ) {
  color *= toneMappingExposure;
  float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(l), color, 0.92);
  color *= mix(vec3(0.92, 0.97, 1.06), vec3(1.05, 1.0, 0.92), smoothstep(0.02, 0.45, l));
  color = 0.18 * pow(max(color, 0.0) / 0.18, vec3(1.12));
  return color / (1.0 + color * 0.12);
}`,
);
if (!THREE.ShaderChunk.tonemapping_pars_fragment.includes('0.18 * pow')) console.warn('grade hook not found');

export function useGrade(renderer, exposure = 1.05) {
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = exposure;
}
