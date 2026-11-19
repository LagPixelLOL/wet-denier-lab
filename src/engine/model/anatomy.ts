/**
 * Leg sculpting: axis profile, thigh inflation, knee/ankle/shin bumps and bony regions.
 */
import { computeWeldedNormals } from "../geometry/weld";

/** Smoothed leg axis (x, z pairs) for 100 height bins of 1 cm. */
export function computeLegAxisProfile(positions: ArrayLike<number>): Float64Array {
  const sumX = new Float64Array(100);
  const sumZ = new Float64Array(100);
  const counts = new Float64Array(100);
  for (let i = 0; i < positions.length; i += 3) {
    const bin = Math.min(99, Math.max(0, Math.floor(positions[i + 1] * 100)));
    sumX[bin] += positions[i];
    sumZ[bin] += positions[i + 2];
    counts[bin]++;
  }
  const centers = new Float64Array(200);
  let lastX = 0;
  let lastZ = 0;
  for (let i = 0; i < 100; i++) {
    if (counts[i]) {
      lastX = sumX[i] / counts[i];
      lastZ = sumZ[i] / counts[i];
    }
    centers[i * 2] = lastX;
    centers[i * 2 + 1] = lastZ;
  }
  const smoothed = new Float64Array(200);
  for (let i = 0; i < 100; i++) {
    let sx = 0;
    let sz = 0;
    let wsum = 0;
    for (let k = -3; k <= 3; k++) {
      const idx = Math.min(99, Math.max(0, i + k));
      const w = Math.exp(-(k * k) / 6);
      sx += centers[idx * 2] * w;
      sz += centers[idx * 2 + 1] * w;
      wsum += w;
    }
    smoothed[i * 2] = sx / wsum;
    smoothed[i * 2 + 1] = sz / wsum;
  }
  return smoothed;
}

const THIGH_FLESH = {
  y0: 0.46,
  y1: 0.82,
  amount: 0.095,
};

/** Pushes thigh vertices outward from the axis, in place. Returns `positions`. */
export function inflateThigh(positions: Float32Array, axisProfile: ArrayLike<number>): Float32Array {
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    if (y <= THIGH_FLESH.y0) {
      continue;
    }
    const t = Math.min(1, (y - THIGH_FLESH.y0) / (THIGH_FLESH.y1 - THIGH_FLESH.y0));
    const amount = t * t * (3 - t * 2) * THIGH_FLESH.amount;
    const binF = Math.min(99, y * 100) - 0.5;
    const bin = Math.max(0, Math.min(98, Math.floor(binF)));
    const frac = Math.max(0, Math.min(1, binF - bin));
    const cx = axisProfile[bin * 2] * (1 - frac) + axisProfile[bin * 2 + 2] * frac;
    const cz = axisProfile[bin * 2 + 1] * (1 - frac) + axisProfile[bin * 2 + 3] * frac;
    const dx = positions[i] - cx;
    const dz = positions[i + 2] - cz;
    const r = Math.hypot(dx, dz) || 1;
    const ux = dx / r;
    const uz = dz / r;
    const back = Math.max(0, -uz);
    const side = Math.max(0, -ux);
    const front = Math.max(0, uz);
    const scale = 1 + amount * (0.62 + back * 0.55 * back + side * 0.35 - front * 0.2);
    positions[i] = cx + dx * scale;
    positions[i + 2] = cz + dz * scale;
  }
  return positions;
}

/**
 * The instep, from where it turns up into the shin down to the middle of the foot. The model rounds that corner
 * with a wide curve, which starts far down the foot and stands the top of the instep high above a slender
 * foot's, so the foot looks thick from the side. Each dent takes the surface in by `amount` (m) at (y, z),
 * fading out over `radius`, along `dir` (y, z), which points into the leg there.
 * The first, at the middle of the corner, leaves the instep straight until close to the ankle and turns it into
 * the shin over a shorter curve. The second, lower down, takes off the slight rise that is left on the instep,
 * so that on tiptoe it runs straight from the ankle to where the toes bend.
 */
export const INSTEP = [
  { y: 0.105, z: 0.054, radius: 0.028, amount: 0.006, dir: [-0.62, -0.78] },
  { y: 0.076, z: 0.086, radius: 0.026, amount: 0.0015, dir: [-0.88, -0.47] },
];

/** A place in the leg's side view where the surface moves by `amount` along `dir`, fading out over `radius`. */
interface SideDent {
  y: number;
  z: number;
  radius: number;
  amount: number;
  dir: readonly number[];
}

/** Moves every vertex by the dents it lies in (each measured from where the vertex was). */
function applySideDents(positions: Float32Array, dents: readonly SideDent[]): void {
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    const z = positions[i + 2];
    for (const dent of dents) {
      const dy = (y - dent.y) / dent.radius;
      const dz = (z - dent.z) / dent.radius;
      const d2 = dy * dy + dz * dz;
      if (d2 < 9) {
        const amount = dent.amount * Math.exp(-d2);
        positions[i + 1] += dent.dir[0] * amount;
        positions[i + 2] += dent.dir[1] * amount;
      }
    }
  }
}

/** Takes the instep in (see INSTEP), in place. Returns `positions`. */
export function slimInstep(positions: Float32Array): Float32Array {
  applySideDents(positions, INSTEP);
  return positions;
}

/**
 * The heel: a little bigger, and rounder underneath.
 * `center` (x, y, z) is the middle of the heel and `grow` how much further out its surface lies, to the sides
 * and backward (the heel gains more length than width), fading out over `reach` in height and from `fade[0]`
 * to `fade[1]` along the foot.
 * Underneath, the skin up to about `sole` above the floor is lifted around the middle of the heel: by `lift` at
 * `rim` from that middle, growing with the square of the distance. The lowest point stays on the floor.
 * `round` then shapes the back of the heel into more of a ball, seen from the side: it takes in the shoulder
 * where the heel runs up into the Achilles tendon, and fills out the corner between its back and the sole.
 */
export const HEEL = {
  center: [0.004, 0.028, -0.022],
  grow: [0.045, 0.11],
  reach: 0.035,
  fade: [-0.02, 0.035],
  sole: 0.012,
  lift: 0.003,
  rim: 0.034,
  round: [
    { y: 0.055, z: -0.053, radius: 0.014, amount: 0.0012, dir: [-0.34, 0.94] },
    { y: 0.009, z: -0.048, radius: 0.014, amount: 0.0012, dir: [-0.45, -0.89] },
  ],
};

/** Shapes the heel (see HEEL), in place. Returns `positions`. */
export function shapeHeel(positions: Float32Array): Float32Array {
  const [cx, cy, cz] = HEEL.center;
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (z >= HEEL.fade[1] || y > cy + HEEL.reach * 3) {
      continue;
    }
    const t = Math.min(1, Math.max(0, (z - HEEL.fade[0]) / (HEEL.fade[1] - HEEL.fade[0])));
    const along = 1 - t * t * (3 - t * 2);
    const dx = positions[i] - cx;
    const dz = z - cz;
    const grow = along * Math.exp(-(((y - cy) / HEEL.reach) ** 2));
    const out = Math.min(1.5, (dx * dx + dz * dz) / (HEEL.rim * HEEL.rim));
    positions[i] += dx * grow * HEEL.grow[0];
    positions[i + 1] += HEEL.lift * out * along * Math.exp(-((y / HEEL.sole) ** 2));
    positions[i + 2] += Math.min(dz, 0) * grow * HEEL.grow[1];
  }
  applySideDents(positions, HEEL.round);
  return positions;
}

/** Anisotropic Gaussian: center, radii, amplitude, facing direction and optional flattening exponent. */
interface GaussianBlob {
  c: readonly number[];
  r: readonly number[];
  a: number;
  d: readonly number[];
  flat?: number;
}

const ANATOMY_BUMPS: GaussianBlob[] = [
  {
    c: [-0.003, 0.497, 0.08],
    r: [0.024, 0.027, 0.03],
    a: 0.0024,
    d: [0, 0, 1],
    flat: 1.6,
  },
  {
    c: [-0.003, 0.462, 0.07],
    r: [0.03, 0.008, 0.03],
    a: -0.0012,
    d: [0, 0, 1],
  },
  {
    c: [-0.002, 0.438, 0.066],
    r: [0.012, 0.016, 0.03],
    a: 0.001,
    d: [0, 0, 1],
  },
  {
    c: [-0.041, 0.498, 0.06],
    r: [0.012, 0.024, 0.02],
    a: -0.0016,
    d: [-0.64, 0, 0.77],
  },
  {
    c: [0.033, 0.498, 0.056],
    r: [0.012, 0.024, 0.02],
    a: -0.0014,
    d: [0.64, 0, 0.77],
  },
  {
    c: [0.001, 0.497, -0.047],
    r: [0.02, 0.034, 0.03],
    a: -0.0024,
    d: [0, 0, -1],
  },
  {
    c: [-0.04, 0.525, -0.018],
    r: [0.009, 0.05, 0.02],
    a: 0.0021,
    d: [-0.64, 0, -0.77],
  },
  {
    c: [0.034, 0.525, -0.022],
    r: [0.009, 0.05, 0.02],
    a: 0.0019,
    d: [0.64, 0, -0.77],
  },
  {
    c: [-0.029, 0.086, 0.008],
    r: [0.015, 0.017, 0.016],
    a: 0.0026,
    d: [-1, 0, 0],
  },
  {
    c: [0.045, 0.073, -0.002],
    r: [0.013, 0.015, 0.014],
    a: 0.0012,
    d: [1, 0, 0],
  },
  {
    c: [0.01, 0.115, -0.042],
    r: [0.0075, 0.065, 0.03],
    a: 0.0022,
    d: [0, 0, -1],
  },
  {
    c: [0.032, 0.085, -0.028],
    r: [0.01, 0.03, 0.012],
    a: -0.0024,
    d: [0.7, 0, -0.7],
  },
  {
    c: [-0.014, 0.09, -0.026],
    r: [0.01, 0.03, 0.012],
    a: -0.0024,
    d: [-0.7, 0, -0.7],
  },
  {
    c: [0.006, 0.3, 0.044],
    r: [0.009, 0.12, 0.03],
    a: 0.0008,
    d: [0, 0, 1],
  },
];

const BONY_REGIONS: GaussianBlob[] = [
  {
    c: [-0.003, 0.49, 0.075],
    r: [0.04, 0.046, 0.04],
    a: 1,
    d: [0, 0, 1],
  },
  {
    c: [0.006, 0.028, -0.04],
    r: [0.036, 0.034, 0.03],
    a: 0.8,
    d: [0, -0.3, -0.95],
  },
  {
    c: [-0.005, 0.012, 0.185],
    r: [0.055, 0.022, 0.035],
    a: 0.75,
    d: [0, 0.2, 0.98],
  },
  {
    c: [-0.031, 0.086, 0.008],
    r: [0.016, 0.017, 0.016],
    a: 0.5,
    d: [-1, 0, 0],
  },
  {
    c: [0.046, 0.073, -0.002],
    r: [0.016, 0.017, 0.016],
    a: 0.5,
    d: [1, 0, 0],
  },
];

function sumGaussianBlobs(
  blobs: readonly GaussianBlob[],
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
): number {
  let total = 0;
  for (const blob of blobs) {
    const dy = (y - blob.c[1]) / blob.r[1];
    if (dy > 2.6 || dy < -2.6) {
      continue;
    }
    const dx = (x - blob.c[0]) / blob.r[0];
    const dz = (z - blob.c[2]) / blob.r[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 7) {
      continue;
    }
    const facing = Math.min(1, Math.max(0, (nx * blob.d[0] + ny * blob.d[1] + nz * blob.d[2]) / 0.5));
    total += blob.a * Math.exp(-Math.pow(d2, blob.flat || 1)) * facing * facing * (3 - facing * 2);
  }
  return total;
}

/** How bony (and so how flushed) the skin is at a point with the given normal, 0 to 1. */
export function bonyAt(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  return Math.min(1, sumGaussianBlobs(BONY_REGIONS, x, y, z, nx, ny, nz));
}

/**
 * Displaces `positions` along the normals by the anatomy bumps, in place.
 * Returns per-vertex skinFx pairs: (bump depth, bony factor).
 */
export function applyAnatomyBumps(
  positions: Float32Array,
  indices: ArrayLike<number>,
  weld: ArrayLike<number>,
): Float32Array {
  const normals = computeWeldedNormals(positions, indices, weld);
  const vertexCount = positions.length / 3;
  const offsets = new Float32Array(vertexCount);
  const bony = new Float32Array(vertexCount);
  const skinFx = new Float32Array(vertexCount * 2);
  // Both fields are sampled on the canonical (welded) vertex before any vertex moves, so seam duplicates agree.
  for (let i = 0; i < vertexCount; i++) {
    if (weld[i] === i) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const nx = normals[i * 3];
      const ny = normals[i * 3 + 1];
      const nz = normals[i * 3 + 2];
      offsets[i] = sumGaussianBlobs(ANATOMY_BUMPS, x, y, z, nx, ny, nz);
      bony[i] = bonyAt(x, y, z, nx, ny, nz);
    }
  }
  for (let i = 0; i < vertexCount; i++) {
    const w = weld[i];
    const offset = offsets[w];
    skinFx[i * 2] = Math.max(-1, Math.min(1, -offset / 0.0022));
    skinFx[i * 2 + 1] = bony[w];
    if (offset) {
      positions[i * 3] += normals[i * 3] * offset;
      positions[i * 3 + 1] += normals[i * 3 + 1] * offset;
      positions[i * 3 + 2] += normals[i * 3 + 2] * offset;
    }
  }
  return skinFx;
}
