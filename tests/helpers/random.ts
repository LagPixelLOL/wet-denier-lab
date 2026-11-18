import { vi } from "vitest";

/** Deterministic Math.random (32-bit LCG). Returns a restore function. */
export function seedRandom(seed = 1): () => void {
  let state = seed >>> 0;
  const spy = vi.spyOn(Math, "random").mockImplementation(() => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  });
  return () => spy.mockRestore();
}
