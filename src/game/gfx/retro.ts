import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Constants } from "@babylonjs/core/Engines/constants";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";

/** Last pass: an ordered dither down to a few steps per channel, the hurt and heat edges of the screen. */
export class Retro {
  steps = 30;
  hurt = 0;
  white = 0;
  heal = 0;
  fade = 0;
  private post: PostProcess | null = null;

  constructor(private camera: Camera, private engine: AbstractEngine) {
    const dither = `
      float b2(vec2 a) { vec2 f = floor(a); return fract(f.x / 2.0 + f.y * f.y * 0.75); }
      float bayer(vec2 a) { return b2(a * 0.5) * 0.25 + b2(a); }`;
    Effect.ShadersStore.fcRetroFragmentShader = `
      precision highp float; varying vec2 vUV; uniform sampler2D textureSampler; uniform vec4 steps; uniform vec4 edge;
      ${dither}
      void main() {
        vec4 c = texture2D(textureSampler, vUV);
        vec2 uv = vUV * 2.0 - 1.0; float r = dot(uv, uv) * 0.5; float rim = smoothstep(0.25, 1.1, r);
        c.rgb = mix(c.rgb, vec3(0.75, 0.16, 0.02), rim * edge.x); c.rgb += vec3(1.0, 0.75, 0.4) * rim * edge.y * 0.5; c.rgb = mix(c.rgb, vec3(0.2, 0.9, 1.0), rim * edge.z * 0.5);
        c.rgb = clamp(c.rgb, 0.0, 1.0);
        vec3 q = c.rgb * steps.x; vec3 lo = floor(q);
        c = vec4((lo + step(vec3(bayer(gl_FragCoord.xy) + 0.03125), q - lo)) / steps.x, 1.0);
        c.rgb *= 1.0 - edge.w;
        gl_FragColor = c;
      }`;
    ShaderStore.ShadersStoreWGSL.fcRetroFragmentShader = `
      varying vUV: vec2f; var textureSamplerSampler: sampler; var textureSampler: texture_2d<f32>; uniform steps: vec4f; uniform edge: vec4f;
      fn b2(a: vec2f) -> f32 { let f = floor(a); return fract(f.x / 2.0 + f.y * f.y * 0.75); }
      fn bayer(a: vec2f) -> f32 { return b2(a * 0.5) * 0.25 + b2(a); }
      @fragment
      fn main(input: FragmentInputs) -> FragmentOutputs {
        var c = textureSample(textureSampler, textureSamplerSampler, input.vUV).rgb;
        let uv = input.vUV * 2.0 - vec2f(1.0); let r = dot(uv, uv) * 0.5; let rim = smoothstep(0.25, 1.1, r);
        c = mix(c, vec3f(0.75, 0.16, 0.02), rim * uniforms.edge.x); c = c + vec3f(1.0, 0.75, 0.4) * rim * uniforms.edge.y * 0.5; c = mix(c, vec3f(0.2, 0.9, 1.0), rim * uniforms.edge.z * 0.5);
        let q = clamp(c, vec3f(0.0), vec3f(1.0)) * uniforms.steps.x; let lo = floor(q);
        c = (lo + step(vec3f(bayer(fragmentInputs.position.xy) + 0.03125), q - lo)) / uniforms.steps.x;
        fragmentOutputs.color = vec4f(c * (1.0 - uniforms.edge.w), 1.0);
      }`;
    this.reattach();
  }

  /** The pipeline rebuilds itself on quality changes; this pass goes back to the end. */
  reattach() {
    this.post?.dispose(this.camera);
    const post = new PostProcess("fcRetro", "fcRetro", { uniforms: ["steps", "edge"], size: 1, camera: this.camera, engine: this.engine, samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE, shaderLanguage: this.engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL });
    post.onApply = (effect) => {
      effect.setFloat4("steps", this.steps, 0, 0, 0);
      effect.setFloat4("edge", this.hurt, this.white, this.heal, this.fade);
    };
    this.post = post;
  }
}
