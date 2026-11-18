/**
 * Vertex welding and smooth normals that ignore UV seams.
 */
import * as THREE from "three";

export function weldVertices(positions) {
  const vertexCount = positions.length / 3;
  const canonical = new Int32Array(vertexCount);
  const keyToIndex = new Map();
  for (let i = 0; i < vertexCount; i++) {
    const key =
      Math.round(positions[i * 3] * 100000) +
      "," +
      Math.round(positions[i * 3 + 1] * 100000) +
      "," +
      Math.round(positions[i * 3 + 2] * 100000);
    let canonicalIdx = keyToIndex.get(key);
    if (canonicalIdx === undefined) {
      canonicalIdx = i;
      keyToIndex.set(key, i);
    }
    canonical[i] = canonicalIdx;
  }
  return canonical;
}

export function computeWeldedNormals(positions, indices, weld) {
  const accum = new Float64Array(positions.length);
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const e1x = positions[b * 3] - ax;
    const e1y = positions[b * 3 + 1] - ay;
    const e1z = positions[b * 3 + 2] - az;
    const e2x = positions[c * 3] - ax;
    const e2y = positions[c * 3 + 1] - ay;
    const e2z = positions[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const w of [weld[a], weld[b], weld[c]]) {
      accum[w * 3] += nx;
      accum[w * 3 + 1] += ny;
      accum[w * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length / 3; i++) {
    const base = weld[i] * 3;
    const sx = accum[base];
    const sy = accum[base + 1];
    const sz = accum[base + 2];
    const len = Math.hypot(sx, sy, sz) || 1;
    normals[i * 3] = sx / len;
    normals[i * 3 + 1] = sy / len;
    normals[i * 3 + 2] = sz / len;
  }
  return normals;
}

export function buildGeometry(positions, uvs, indices, weld = weldVertices(positions)) {
  const normals = computeWeldedNormals(positions, indices, weld);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  if (uvs) {
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
