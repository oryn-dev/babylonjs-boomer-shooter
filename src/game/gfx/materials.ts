import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Scene } from "@babylonjs/core/scene";
import { LAYERS } from "../level/build";
import { MAX_LIGHTS } from "./lights";
import { makeShader, type ShaderSpec } from "./shader";
import type { Surfaces } from "./textures";

export const BONES = 24;
const id = (name: string) => `${LAYERS.indexOf(name)}.0`;

const LIGHTING = `
vec3 linear(vec3 c) { return c * (c * (c * 0.305306011 + vec3(0.682171111)) + vec3(0.012522878)); }
vec3 dynamicLight(vec3 p, vec3 n, vec3 v, vec3 albedo, float gloss) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec4 a = u_lightPos[i];
    vec3 d = a.xyz - p;
    float l = dot(d, d);
    float r = a.w;
    if (l < r * r) {
      float dist = sqrt(l) + 0.0001;
      vec3 dir = d / dist;
      float fall = 1.0 - dist / r;
      float nl = max(0.0, dot(n, dir) * 0.85 + 0.15);
      vec3 h = normalize(dir + v);
      float s = pow(max(0.0, dot(n, h)), 6.0 + gloss * 40.0) * gloss * 1.6;
      sum += u_lightColor[i].xyz * fall * fall * (albedo * nl + vec3(s) * nl);
    }
  }
  return sum;
}
vec3 applyFog(vec3 color, vec3 p, float dist) {
  float low = exp(-max(0.0, p.y - u_fogHeight.x) / u_fogHeight.y) * u_fogHeight.z;
  float f = 1.0 - exp(-dist * (u_fog.w + low));
  return mix(color, u_fog.xyz, f);
}
`;

const COMMON = { u_eye: "vec4", u_fog: "vec4", u_fogHeight: "vec4", u_lightPos: `vec4[${MAX_LIGHTS}]`, u_lightColor: `vec4[${MAX_LIGHTS}]` } as const;

const WORLD: ShaderSpec = {
  attributes: { a_position: "vec3", a_normal: "vec3", a_tangent3: "vec3", a_uv: "vec2", a_layer: "float", a_lm: "vec2", a_baked: "vec4", a_bakedDir: "vec3" },
  varyings: { v_p: "vec3", v_n: "vec3", v_t: "vec3", v_uv: "vec2", v_layer: "float", v_lm: "vec2", v_baked: "vec4", v_dir: "vec3" },
  uniforms: { ...COMMON, u_atlas: "vec4", u_pixel: "vec4" },
  samplers: { albedo: "array", detail: "array", lightMap: "2d", dirMap: "2d" },
  shared: LIGHTING,
  vertex: `
v_p = a_position; v_n = a_normal; v_t = a_tangent3; v_uv = a_uv; v_layer = a_layer; v_lm = a_lm; v_baked = a_baked; v_dir = a_bakedDir;
POSITION = u_viewProjection * vec4(a_position, 1.0);`,
  fragment: `
vec3 n0 = normalize(v_n);
vec3 t0 = normalize(v_t - n0 * dot(v_t, n0));
vec3 b0 = cross(n0, t0);
float layer = floor(v_layer + 0.5);
float molten = step(abs(layer - ${id("molten")}), 0.5);
float oil = step(abs(layer - ${id("oil")}), 0.5);
float t = u_eye.w;
vec2 grid = floor(v_uv * 128.0) / 128.0;
vec2 drift = vec2(sin(grid.y * 12.0 + t * 0.7) + sin(grid.y * 31.0 - t * 0.5) * 0.4, cos(grid.x * 11.0 - t * 0.6) + cos(grid.x * 27.0 + t * 0.4) * 0.4) * 0.03 + vec2(t * 0.012, t * 0.02);
vec2 uv = v_uv + floor(drift * 128.0) / 128.0 * (molten + oil);
vec4 tex = TEXA(albedo, uv, layer);
vec4 det = TEXA(detail, uv, layer);
vec2 along = vec2(dot(v_p, t0), dot(v_p, b0)) * u_pixel.x;
vec2 shift = (floor(along) + vec2(0.5) - along) / u_pixel.x;
vec3 p = v_p + t0 * shift.x + b0 * shift.y;
vec2 lm = v_lm + shift * u_atlas.z * (1.0 - v_baked.w);
vec4 lit = TEX(lightMap, lm * u_atlas.xy);
vec4 ld = TEX(dirMap, lm * u_atlas.xy);
vec2 nm = det.xy * 2.0 - vec2(1.0);
vec3 n = normalize(t0 * nm.x * 1.1 + b0 * nm.y * 1.1 + n0);
float glow = max(0.0, det.z * 2.0 - 1.0);
float gloss = det.z * 2.0 * step(det.z, 0.5);
vec3 base = linear(tex.xyz);
vec3 baked = max(mix(lit.xyz * lit.xyz * 8.0, v_baked.xyz, v_baked.w), vec3(0.1, 0.115, 0.125));
vec3 dir = mix(ld.xyz * 2.0 - vec3(1.0), v_dir, v_baked.w);
float sure = min(1.0, length(dir));
vec3 dn = dir / max(0.001, length(dir));
vec3 v = normalize(u_eye.xyz - v_p);
float bump = max(0.0, dot(n, dn)) / max(0.22, dot(n0, dn));
vec3 diffuse = baked * mix(1.0, min(bump, 2.0), sure * 0.85);
vec3 h = normalize(dn + v);
float spec = pow(max(0.0, dot(n, h)), 5.0 + gloss * 36.0) * gloss * sure * 1.5;
vec3 color = base * diffuse + baked * spec + dynamicLight(p + n0 * 0.02, n, v, base, gloss);
color += base * glow * mix(2.0, 0.85, molten) * (1.0 + molten * sin(t * 1.3 + p.x * 0.4 + p.z * 0.3) * 0.12);
COLOR = vec4(applyFog(color, v_p, distance(u_eye.xyz, v_p)), 1.0);`,
};

const ACTOR: ShaderSpec = {
  attributes: { a_position: "vec3", a_normal: "vec3", a_tangent3: "vec3", a_uv: "vec2", a_layer: "float", a_part: "float", a_tint: "vec4" },
  varyings: { v_p: "vec3", v_n: "vec3", v_t: "vec3", v_uv: "vec2", v_layer: "float", v_tint: "vec4" },
  uniforms: { ...COMMON, u_bones: `mat4[${BONES}]`, u_amb: "vec4", u_low: "vec4", u_key: "vec4", u_keyDir: "vec4", u_flash: "vec4", u_extra: "vec4", u_vp: "mat4" },
  samplers: { albedo: "array", detail: "array" },
  shared: LIGHTING,
  vertex: `
mat4 bone = u_bones[int(a_part + 0.5)];
vec4 wp = bone * vec4(a_position, 1.0);
v_p = wp.xyz;
v_n = (bone * vec4(a_normal, 0.0)).xyz; v_t = (bone * vec4(a_tangent3, 0.0)).xyz;
v_uv = a_uv; v_layer = a_layer; v_tint = a_tint;
vec4 clip = u_vp * wp;
POSITION = clip;`,
  fragment: `
vec3 n0 = normalize(v_n);
vec3 t0 = normalize(v_t - n0 * dot(v_t, n0));
vec3 b0 = cross(n0, t0);
float layer = floor(v_layer + 0.5);
vec4 tex = TEXA(albedo, v_uv, layer);
vec4 det = TEXA(detail, v_uv, layer);
vec2 nm = det.xy * 2.0 - vec2(1.0);
vec3 n = normalize(t0 * nm.x + b0 * nm.y + n0);
float glow = max(0.0, det.z * 2.0 - 1.0);
float gloss = det.z * 2.0 * step(det.z, 0.5);
vec3 tint = linear(v_tint.xyz);
vec3 base = linear(tex.xyz) * tint;
vec3 v = normalize(u_eye.xyz - v_p);
vec3 kd = u_keyDir.xyz;
float nk = max(0.0, dot(n, kd));
vec3 amb = mix(u_low.xyz, u_amb.xyz, n.y * 0.5 + 0.5);
vec3 h = normalize(kd + v);
float spec = pow(max(0.0, dot(n, h)), 6.0 + gloss * 40.0) * gloss * 1.5;
vec3 color = base * (amb + u_key.xyz * nk) + u_key.xyz * spec + dynamicLight(v_p, n, v, base, gloss);
float rim = pow(1.0 - max(0.0, dot(n, v)), 3.0);
color += (amb + u_key.xyz * 0.4) * rim * u_extra.y * 0.5;
float own = step(0.02, glow);
color += base * glow * (1.0 + v_tint.w * 4.0) * u_extra.x * own;
float heat = u_extra.z * v_tint.w * (1.0 - own);
vec3 hot = vec3(1.5, 0.22, 0.02) * smoothstep(0.1, 0.55, heat) + vec3(1.6, 1.0, 0.25) * smoothstep(0.5, 0.85, heat) + vec3(1.2, 1.6, 2.0) * smoothstep(0.85, 1.0, heat);
color += hot * (0.6 + 0.4 * tex.x);
color = mix(color, u_flash.xyz, u_flash.w);
color = applyFog(color, v_p, distance(u_eye.xyz, v_p) * u_extra.w);
COLOR = vec4(color, 1.0);`,
};

export function v4(m: ShaderMaterial, name: string, x: number, y: number, z: number, w: number) {
  m.setVector4(name, { x, y, z, w });
}

export function worldMaterial(scene: Scene, s: Surfaces, lightMap: BaseTexture, dirMap: BaseTexture, atlas: { w: number; h: number }, density: number) {
  const m = makeShader(scene, "fcWorld", WORLD);
  m.setTexture("albedo", s.albedo);
  m.setTexture("detail", s.detail);
  m.setTexture("lightMap", lightMap);
  m.setTexture("dirMap", dirMap);
  v4(m, "u_atlas", 1 / atlas.w, 1 / atlas.h, density, 0);
  v4(m, "u_pixel", 32, 0, 0, 0);
  return m;
}

export function actorMaterial(scene: Scene, s: Surfaces): ShaderMaterial {
  const m = makeShader(scene, "fcActor", ACTOR);
  m.setTexture("albedo", s.albedo);
  m.setTexture("detail", s.detail);
  return m;
}
