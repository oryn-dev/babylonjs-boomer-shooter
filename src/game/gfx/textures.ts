import { Constants } from "@babylonjs/core/Engines/constants";
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import data from "./layers.json";

export async function pixels(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" })!;
  ctx.drawImage(image, 0, 0);
  return { data: new Uint8Array(ctx.getImageData(0, 0, image.width, image.height).data.buffer), width: image.width, height: image.height };
}

/** Box-filtered mip chain of one layer, kept by hand so both renderers get the same one. */
function layerArray(scene: Scene, name: string, source: Uint8Array) {
  const size = data.size;
  const layers = data.layers.length;
  const levels = Math.log2(size) + 1;
  const texture = new RawTexture2DArray(source, size, size, layers, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE, undefined, levels);
  texture.name = name;
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.updateSamplingMode(Texture.NEAREST_LINEAR_MIPLINEAR);
  texture.anisotropicFilteringLevel = 4;
  return texture;
}

export interface Surfaces {
  albedo: RawTexture2DArray;
  detail: RawTexture2DArray;
}

export async function loadSurfaces(scene: Scene, url: (path: string) => string): Promise<Surfaces> {
  const [albedo, detail] = await Promise.all([pixels(url("tex/albedo.png")), pixels(url("tex/detail.png"))]);
  return { albedo: layerArray(scene, "albedo", albedo.data), detail: layerArray(scene, "detail", detail.data) };
}

export async function loadData(scene: Scene, url: string, linear = true) {
  const { data: raw, width, height } = await pixels(url);
  const texture = RawTexture.CreateRGBATexture(raw, width, height, scene, false, false, linear ? Texture.BILINEAR_SAMPLINGMODE : Texture.NEAREST_SAMPLINGMODE);
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

export function plainTexture(scene: Scene, rgba: [number, number, number, number]) {
  return RawTexture.CreateRGBATexture(new Uint8Array(rgba), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
}
