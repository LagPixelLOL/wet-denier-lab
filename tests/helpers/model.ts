import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseModelGlb, type ModelData } from "../../src/engine/model/glb";
import { buildLegModel, type LegModel } from "../../src/engine/model/legModel";
import { SurfaceGrid } from "../../src/engine/surface/SurfaceGrid";

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

let gap: { x: number; z: number } | undefined;

/**
 * A rest-space x and z in the gap between the big toe and the second toe, 2 cm behind their nails. Found by
 * shooting rays straight down at the forefoot's skin between the two nails: the middle of those that pass
 * through.
 */
export function toeGap(): { x: number; z: number } {
  if (!gap) {
    const model = legModel();
    const skin = new SurfaceGrid(model.forefootCollision!, 0.004);
    const [big, second] = model.nails;
    const z = Math.min(big.center[2], second.center[2]) - 0.02;
    const open: number[] = [];
    for (let k = 0; k <= 40; k++) {
      const x = big.center[0] + ((second.center[0] - big.center[0]) * k) / 40;
      if (!skin.raycast(x, 0.1, z, 0, -1, 0)) {
        open.push(x);
      }
    }
    // The gap is a few millimeters wide there, so several rays in a row pass through it.
    if (open.length < 4 || Math.abs(open[open.length - 1] - open[0]) > 0.008) {
      throw new Error("no gap between the first two toes: " + open.join(" "));
    }
    gap = { x: (open[0] + open[open.length - 1]) / 2, z };
  }
  return gap;
}
