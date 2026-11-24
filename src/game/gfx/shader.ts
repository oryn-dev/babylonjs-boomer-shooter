import { Constants } from "@babylonjs/core/Engines/constants";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Scene } from "@babylonjs/core/scene";

/*
 * Shaders are written once in a small GLSL dialect and translated for WebGPU.
 * a_x attribute, v_x varying, u_x uniform; TEX(map, uv), TEXL(map, uv) without derivatives, TEXA(map, uv, layer) for arrays.
 */
const TYPES: Record<string, string> = { float: "f32", vec2: "vec2f", vec3: "vec3f", vec4: "vec4f", mat4: "mat4x4f", int: "i32" };

export function toWgsl(source: string, stage: "vertex" | "fragment" | "shared") {
  return source
    .replace(/\b(float|vec2|vec3|vec4|mat4)\s+(\w+)\s*\(([^)]*)\)\s*\{/g, (_, result, name, params: string) => {
      const list = params.split(",").map((part) => part.trim()).filter(Boolean).map((part) => part.split(/\s+/)).map(([kind, id]) => `${id}: ${TYPES[kind]}`);
      return `fn ${name}(${list.join(", ")}) -> ${TYPES[result]} {`;
    })
    .replace(/for \(int (\w+) = /g, "for (var $1: i32 = ")
    .replace(/(^|[;{}\s])(float|vec2|vec3|vec4|mat4)\s+(\w+)\s*=/g, (_, before, kind, id) => `${before}var ${id}: ${TYPES[kind]} =`)
    .replace(/\b(vec2|vec3|vec4)\(/g, (_, kind) => `${TYPES[kind]}(`)
    .replace(/\bfloat\(/g, "f32(")
    .replace(/\bint\(/g, "i32(")
    .replace(/\bTEXA\((\w+),\s*([^,]+),\s*([^)]+)\)/g, "textureSample($1, $1Sampler, $2, i32($3))")
    .replace(/\bTEXL\((\w+),((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g, "textureSampleLevel($1, $1Sampler,$2, 0.0)")
    .replace(/\bTEX\((\w+),/g, "textureSample($1, $1Sampler,")
    .replace(/\bu_(world|viewProjection)\b/g, "uniforms.$1")
    .replace(/\bu_(\w+)/g, "uniforms.u_$1")
    .replace(/\ba_(\w+)/g, "vertexInputs.$1")
    .replace(/\bv_(\w+)/g, stage === "vertex" ? "vertexOutputs.v_$1" : "fragmentInputs.v_$1");
}

export function toGlsl(source: string) {
  return source
    .replace(/\bTEXA\((\w+),\s*([^,]+),\s*([^)]+)\)/g, "texture($1, vec3($2, $3))")
    .replace(/\bTEXL?\((\w+),/g, "texture2D($1,")
    .replace(/\bu_(world|viewProjection)\b/g, "$1")
    .replace(/\ba_(\w+)/g, "$1");
}

type Kind = "float" | "vec2" | "vec3" | "vec4" | "mat4";
type Uniform = Kind | `vec4[${number}]` | `mat4[${number}]`;

export interface ShaderSpec {
  attributes: Record<string, Kind>;
  varyings: Record<string, Kind>;
  /** Beside u_viewProjection and u_world, which Babylon binds. */
  uniforms: Record<string, Uniform>;
  samplers?: Record<string, "2d" | "array">;
  shared?: string;
  /** Sets POSITION. */
  vertex: string;
  /** Sets COLOR. */
  fragment: string;
  /** "pre": premultiplied, so one draw mixes additive and covering colours. */
  blend?: "pre" | "add" | "alpha";
}

const split = (kind: Uniform) => /^(\w+)\[(\d+)\]$/.exec(kind);

function register(wgsl: boolean, name: string, spec: ShaderSpec) {
  const uniforms: Record<string, Uniform> = { viewProjection: "mat4", world: "mat4", ...spec.uniforms };
  const list = <T>(entries: Record<string, T>, line: (id: string, kind: T) => string) => Object.entries(entries).map(([id, kind]) => line(id, kind)).join("\n");
  if (wgsl) {
    const u = list(uniforms, (id, kind) => {
      const array = split(kind);
      return array ? `uniform ${id}: array<${TYPES[array[1]]}, ${array[2]}>;` : `uniform ${id}: ${TYPES[kind]};`;
    });
    const v = list(spec.varyings, (id, kind) => `varying ${id}: ${TYPES[kind]};`);
    const s = list(spec.samplers ?? {}, (id, kind) => `var ${id}Sampler: sampler; var ${id}: ${kind === "array" ? "texture_2d_array<f32>" : "texture_2d<f32>"};`);
    const clean = (code: string, stage: "vertex" | "fragment") => toWgsl(code, stage).replace(/\bPOSITION\b/g, "vertexOutputs.position").replace(/\bCOLOR\b/g, "fragmentOutputs.color");
    ShaderStore.ShadersStoreWGSL[`${name}VertexShader`] = `${list(spec.attributes, (id, kind) => `attribute ${id.slice(2)}: ${TYPES[kind]};`)}\n${u}\n${v}\n@vertex\nfn main(input: VertexInputs) -> FragmentInputs {\n${clean(spec.vertex, "vertex")}\n}`;
    ShaderStore.ShadersStoreWGSL[`${name}FragmentShader`] = `${u}\n${v}\n${s}\n${toWgsl(spec.shared ?? "", "fragment")}\n@fragment\nfn main(input: FragmentInputs) -> FragmentOutputs {\n${clean(spec.fragment, "fragment")}\n}`;
  } else {
    const u = list(uniforms, (id, kind) => {
      const array = split(kind);
      return array ? `uniform ${array[1]} ${id}[${array[2]}];` : `uniform ${kind} ${id};`;
    });
    const v = list(spec.varyings, (id, kind) => `varying ${kind} ${id};`);
    const s = list(spec.samplers ?? {}, (id, kind) => `uniform highp ${kind === "array" ? "sampler2DArray" : "sampler2D"} ${id};`);
    Effect.ShadersStore[`${name}VertexShader`] = `precision highp float;\n${list(spec.attributes, (id, kind) => `attribute ${kind} ${id.slice(2)};`)}\n${u}\n${v}\nvoid main() {\n${toGlsl(spec.vertex).replace(/\bPOSITION\b/g, "gl_Position")}\n}`;
    Effect.ShadersStore[`${name}FragmentShader`] = `precision highp float;\n${u}\n${v}\n${s}\n${toGlsl(spec.shared ?? "")}\nvoid main() {\n${toGlsl(spec.fragment).replace(/\bCOLOR\b/g, "gl_FragColor")}\n}`;
  }
  return Object.keys(uniforms);
}

export function makeShader(scene: Scene, name: string, spec: ShaderSpec) {
  const wgsl = scene.getEngine().isWebGPU;
  const uniforms = register(wgsl, name, spec);
  const material = new ShaderMaterial(name, scene, name, {
    attributes: Object.keys(spec.attributes).map((id) => id.slice(2)),
    uniforms,
    samplers: Object.keys(spec.samplers ?? {}),
    needAlphaBlending: Boolean(spec.blend),
    shaderLanguage: wgsl ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
  });
  material.backFaceCulling = !spec.blend;
  if (spec.blend) {
    material.alphaMode = { pre: Constants.ALPHA_PREMULTIPLIED, add: Constants.ALPHA_ADD, alpha: Constants.ALPHA_COMBINE }[spec.blend];
    material.disableDepthWrite = true;
  }
  return material;
}
