import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseModelGlb, type ModelData } from "../../src/engine/model/glb";
import { buildLegModel, type LegModel } from "../../src/engine/model/legModel";

// Resolved from the project root (Vitest runs there); import.meta.url is rewritten in jsdom test files.
const GLB_PATH = resolve(process.cwd(), "src/assets/model/legs.glb");

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
