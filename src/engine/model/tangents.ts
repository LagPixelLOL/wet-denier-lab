/**
 * "Up the leg" tangents and fabric stretch (circumference relative to a reference).
 */
import * as THREE from "three";

export function computeLegTangents(geometry) {
  const normals = geometry.attributes.normal.array;
  const count = normals.length / 3;
  const tangents = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    const ux = -ny * nx;
    const uy = 1 - ny * ny;
    const uz = -ny * nz;
    const upLen = Math.hypot(ux, uy, uz);
    const fx = -nz * nx;
    const fy = -nz * ny;
    const fz = 1 - nz * nz;
    const fwdLen = Math.hypot(fx, fy, fz) || 1;
    const blend = THREE.MathUtils.smoothstep(upLen, 0.35, 0.75);
    const tx = (fx / fwdLen) * (1 - blend) + (upLen > 0.000001 ? ux / upLen : 0) * blend;
    const ty = (fy / fwdLen) * (1 - blend) + (upLen > 0.000001 ? uy / upLen : 0) * blend;
    const tz = (fz / fwdLen) * (1 - blend) + (upLen > 0.000001 ? uz / upLen : 0) * blend;
    const len = Math.hypot(tx, ty, tz) || 1;
    tangents[i * 3] = tx / len;
    tangents[i * 3 + 1] = ty / len;
    tangents[i * 3 + 2] = tz / len;
  }
  geometry.setAttribute("legTangent", new THREE.BufferAttribute(tangents, 3));
}

export function computeCircumference(geometry, minY = 0.105, refCircumference = 0.34) {
  const positions = geometry.attributes.position.array;
  const count = positions.length / 3;
  const binSize = 0.01;
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
