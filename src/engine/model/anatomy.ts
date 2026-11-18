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
  const skinFx = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i++) {
    if (weld[i] === i) {
      offsets[i] = sumGaussianBlobs(
        ANATOMY_BUMPS,
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
        normals[i * 3],
        normals[i * 3 + 1],
        normals[i * 3 + 2],
      );
    }
  }
  for (let i = 0; i < vertexCount; i++) {
    const w = weld[i];
    const offset = offsets[w];
    skinFx[i * 2] = Math.max(-1, Math.min(1, -offset / 0.0022));
    skinFx[i * 2 + 1] = Math.min(
      1,
      sumGaussianBlobs(
        BONY_REGIONS,
        positions[w * 3],
        positions[w * 3 + 1],
        positions[w * 3 + 2],
        normals[w * 3],
        normals[w * 3 + 1],
        normals[w * 3 + 2],
      ),
    );
    if (offset) {
      positions[i * 3] += normals[i * 3] * offset;
      positions[i * 3 + 1] += normals[i * 3 + 1] * offset;
      positions[i * 3 + 2] += normals[i * 3 + 2] * offset;
    }
  }
  return skinFx;
}
