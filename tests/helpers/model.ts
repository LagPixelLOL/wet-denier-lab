import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseModelGlb, type ModelData } from "../../src/engine/model/glb";
import { buildLegModel, type LegModel } from "../../src/engine/model/legModel";

const GLB_PATH = fileURLToPath(new URL("../../src/assets/model/legs.glb", import.meta.url));

/** The shipped model file as an ArrayBuffer (a fresh copy on every call). */
export function readModelBuffer(): ArrayBuffer {
  const file = readFileSync(GLB_PATH);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

let data: ModelData | undefined;
let model: LegModel | undefined;

/** Parsed model data, shared between tests in the same worker. Do not mutate. */
export function modelData(): ModelData {
  return (data ??= parseModelGlb(readModelBuffer()));
}

/** The fully built leg model (2 subdivision levels, as the app uses). Shared; do not mutate. */
export function legModel(): LegModel {
  return (model ??= buildLegModel(parseModelGlb(readModelBuffer()), { levels: 2 }));
}
