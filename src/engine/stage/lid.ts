/**
 * The leg's outline where its top begins to fade out, for telling what the eye sees through the leg's own top
 * (LID_GLSL in shaders/leg.ts).
 */
import { fadeHeight } from "./shaders/leg";

export interface LegLid {
  /** The middle of the outline, across x and z. */
  center: [number, number];
  /** How far out from the middle the outline reaches, in evenly spaced directions around it. */
  radii: number[];
}

/**
 * Measures the outline of the surface `positions` (x, y, z per vertex, at rest) where it crosses the fade height
 * `height`: its middle and its reach in `bins` directions around the middle, across x and z. The first direction
 * points along -x, and they go on around from x toward z, as atan(z, x) does.
 */
export function legLid(positions: ArrayLike<number>, height: number, bins: number): LegLid {
  // The vertices within a narrow band of that height stand in for the outline: the surface is dense.
  const band = 0.012;
  const ring: [number, number][] = [];
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(fadeHeight(positions[i], positions[i + 1], positions[i + 2]) - height) < band) {
      ring.push([positions[i], positions[i + 2]]);
    }
  }
  if (!ring.length) {
    return { center: [0, 0], radii: Array.from({ length: bins }, () => 0) };
  }
  // The middle of the outline's bounds: the mean would lean toward where the vertices are denser.
  const xs = ring.map(([x]) => x);
  const zs = ring.map(([, z]) => z);
  const center: [number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
  const sums = Array.from({ length: bins }, () => 0);
  const counts = Array.from({ length: bins }, () => 0);
  for (const [x, z] of ring) {
    const turn = (Math.atan2(z - center[1], x - center[0]) / (2 * Math.PI) + 0.5) * bins;
    // The shader reads between a direction and the next: each vertex counts for the one it is nearest to.
    const bin = Math.round(turn) % bins;
    sums[bin] += Math.hypot(x - center[0], z - center[1]);
    counts[bin]++;
  }
  const radii = sums.map((sum, bin) => (counts[bin] ? sum / counts[bin] : NaN));
  // A direction no vertex fell into takes the reach of the nearest ones that have one.
  for (let bin = 0; bin < bins; bin++) {
    if (Number.isNaN(radii[bin])) {
      for (let step = 1; step < bins; step++) {
        const near = [radii[(bin + step) % bins], radii[(bin - step + bins) % bins]].filter((r) => !Number.isNaN(r));
        if (near.length) {
          radii[bin] = near.reduce((sum, r) => sum + r, 0) / near.length;
          break;
        }
      }
    }
  }
  return { center, radii };
}
