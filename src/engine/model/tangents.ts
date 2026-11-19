/**
 * Tangents along the leg and foot, and fabric stretch (circumference relative to a reference).
 */
import * as THREE from "three";

/** The crook of the ankle (y, z), outside the leg: the fabric's wales turn around it from the leg onto the foot. */
const ANKLE_CROOK = [0.13, 0.09];

/**
 * Adds a "legTangent" attribute: the direction the fabric's wales run in, on the surface. That is up the leg
 * above the ankle and forward along the foot in front of it, turning from one to the other around the crook of
 * the ankle. The direction depends on where a vertex is and not on which way it faces, so it only turns
 * quickly at the tips of the toes, where the foot's direction meets the surface head on.
 */
export function computeLegTangents(geometry: THREE.BufferGeometry): void {
  const positions = geometry.attributes.position.array;
  const normals = geometry.attributes.normal.array;
  const count = normals.length / 3;
  const tangents = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    const below = Math.min(positions[i * 3 + 1] - ANKLE_CROOK[0], 0);
    const behind = Math.min(positions[i * 3 + 2] - ANKLE_CROOK[1], 0);
    const turn = Math.hypot(below, behind);
    const dy = below < 0 ? -behind / turn : 1;
    const dz = below < 0 ? -below / turn : 0;
    const along = dy * ny + dz * nz;
    let tx = -along * nx;
    let ty = dy - along * ny;
    let tz = dz - along * nz;
    let len = Math.hypot(tx, ty, tz);
    if (len < 1e-4) {
      // Head on: any direction on the surface will do. Take the other of the two (up for forward, and back).
      tx = -(dz * ny - dy * nz) * nx;
      ty = dz - (dz * ny - dy * nz) * ny;
      tz = -dy - (dz * ny - dy * nz) * nz;
      len = Math.hypot(tx, ty, tz) || 1;
    }
    tangents[i * 3] = tx / len;
    tangents[i * 3 + 1] = ty / len;
    tangents[i * 3 + 2] = tz / len;
  }
  geometry.setAttribute("legTangent", new THREE.BufferAttribute(tangents, 3));
}

const BIN_SIZE = 0.01;
const REF_CIRCUMFERENCE = 0.34;

/** Fabric stretch at height y: the leg's circumference there (from computeCircumference) over the reference. */
export function stretchAt(circumference: ArrayLike<number>, y: number): number {
  return circumference[Math.min(circumference.length - 1, Math.max(0, Math.floor(y / BIN_SIZE)))] / REF_CIRCUMFERENCE;
}

/**
 * Adds a "stretch" attribute (local circumference / refCircumference) and returns the smoothed
 * circumference per 1 cm height bin.
 */
export function computeCircumference(
  geometry: THREE.BufferGeometry,
  minY = 0.105,
  refCircumference = REF_CIRCUMFERENCE,
): Float64Array {
  const positions = geometry.attributes.position.array;
  const count = positions.length / 3;
  const binSize = BIN_SIZE;
  const binCount = Math.ceil(1 / binSize);
  const sumX = new Float64Array(binCount);
  const sumZ = new Float64Array(binCount);
  const counts = new Float64Array(binCount);
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1];
    if (y < minY) {
      continue;
    }
    const bin = Math.min(binCount - 1, Math.floor(y / binSize));
    sumX[bin] += positions[i * 3];
    sumZ[bin] += positions[i * 3 + 2];
    counts[bin]++;
  }
  const radiusSum = new Float64Array(binCount);
  const radiusCount = new Float64Array(binCount);
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1];
    if (y < minY) {
      continue;
    }
    const bin = Math.min(binCount - 1, Math.floor(y / binSize));
    const cx = sumX[bin] / counts[bin];
    const cz = sumZ[bin] / counts[bin];
    radiusSum[bin] += Math.hypot(positions[i * 3] - cx, positions[i * 3 + 2] - cz);
    radiusCount[bin]++;
  }
  const circ = new Float64Array(binCount);
  let last = 0;
  for (let i = 0; i < binCount; i++) {
    if (radiusCount[i] > 0) {
      last = (radiusSum[i] / radiusCount[i]) * Math.PI * 2;
    }
    circ[i] = last;
  }
  const firstValid = circ.findIndex((v) => v > 0);
  for (let i = 0; i < firstValid; i++) {
    circ[i] = circ[firstValid];
  }
  const smoothed = new Float64Array(binCount);
  for (let i = 0; i < binCount; i++) {
    let sum = 0;
    let wsum = 0;
    for (let k = -4; k <= 4; k++) {
      const idx = Math.min(binCount - 1, Math.max(0, i + k));
      const w = Math.exp(-(k * k) / 8);
      sum += circ[idx] * w;
      wsum += w;
    }
    smoothed[i] = sum / wsum;
  }
  const stretch = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor(positions[i * 3 + 1] / binSize)));
    stretch[i] = smoothed[bin] / refCircumference;
  }
  geometry.setAttribute("stretch", new THREE.BufferAttribute(stretch, 1));
  return smoothed;
}
