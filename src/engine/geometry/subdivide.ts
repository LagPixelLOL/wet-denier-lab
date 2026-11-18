/**
 * Smooth 1-to-4 triangle subdivision and the crack-free adaptive index that keeps fine triangles only near the foot.
 */
import { computeWeldedNormals, weldVertices } from "./weld";

export function subdivideSmooth(positions, uvs, indices) {
  const weld = weldVertices(positions);
  const normals = computeWeldedNormals(positions, indices, weld);
  const vertexCount = positions.length / 3;
  const edgeMidpoints = new Map();
  const outPos = new Float32Array(positions.length + indices.length * 3);
  const outUv = uvs ? new Float32Array(uvs.length + indices.length * 2) : null;
  outPos.set(positions);
  if (outUv) {
    outUv.set(uvs);
  }
  let nextVertex = vertexCount;
  const roundness = 0.75;
  function edgeMidpoint(a, b) {
    const key = a < b ? a * 2097152 + b : b * 2097152 + a;
    const cached = edgeMidpoints.get(key);
    if (cached !== undefined) {
      return cached;
    }
    let wa = weld[a];
    let wb = weld[b];
    if (wa > wb) {
      [wa, wb] = [wb, wa];
    }
    const mid = nextVertex++;
    for (let k = 0; k < 3; k++) {
      const va = positions[wa * 3 + k];
      const vb = positions[wb * 3 + k];
      outPos[mid * 3 + k] = (va + vb) / 2;
    }
    const mx = outPos[mid * 3];
    const my = outPos[mid * 3 + 1];
    const mz = outPos[mid * 3 + 2];
    let px = 0;
    let py = 0;
    let pz = 0;
    for (const v of [wa, wb]) {
      const nx = normals[v * 3];
      const ny = normals[v * 3 + 1];
      const nz = normals[v * 3 + 2];
      const dist = (mx - positions[v * 3]) * nx + (my - positions[v * 3 + 1]) * ny + (mz - positions[v * 3 + 2]) * nz;
      px += (mx - dist * nx) / 2;
      py += (my - dist * ny) / 2;
      pz += (mz - dist * nz) / 2;
    }
    outPos[mid * 3] = (1 - roundness) * mx + roundness * px;
    outPos[mid * 3 + 1] = (1 - roundness) * my + roundness * py;
    outPos[mid * 3 + 2] = (1 - roundness) * mz + roundness * pz;
    if (outUv) {
      outUv[mid * 2] = (uvs[a * 2] + uvs[b * 2]) / 2;
      outUv[mid * 2 + 1] = (uvs[a * 2 + 1] + uvs[b * 2 + 1]) / 2;
    }
    edgeMidpoints.set(key, mid);
    return mid;
  }
  const outIdx = new Uint32Array(indices.length * 4);
  for (let t = 0, o = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const ab = edgeMidpoint(a, b);
    const bc = edgeMidpoint(b, c);
    const ca = edgeMidpoint(c, a);
    outIdx.set([a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca], o);
    o += 12;
  }
  return {
    pos: outPos.slice(0, nextVertex * 3),
    uv: outUv ? outUv.slice(0, nextVertex * 2) : null,
    idx: outIdx,
  };
}

export function buildAdaptiveIndex(coarseIdx, fineIdx, finePos, weld, maxY) {
  const triCount = coarseIdx.length / 3;
  const refined = new Uint8Array(triCount);
  const splitEdges = new Set();
  const edgeKey = (a, b) => {
    a = weld[a];
    b = weld[b];
    if (a < b) {
      return a * 2097152 + b;
    } else {
      return b * 2097152 + a;
    }
  };
  for (let t = 0; t < triCount; t++) {
    const a = coarseIdx[t * 3];
    const b = coarseIdx[t * 3 + 1];
    const c = coarseIdx[t * 3 + 2];
    if (Math.min(finePos[a * 3 + 1], finePos[b * 3 + 1], finePos[c * 3 + 1]) < maxY) {
      refined[t] = 1;
      splitEdges.add(edgeKey(a, b));
      splitEdges.add(edgeKey(b, c));
      splitEdges.add(edgeKey(c, a));
    }
  }
  const out = [];
  for (let t = 0; t < triCount; t++) {
    const base = t * 12;
    const a = coarseIdx[t * 3];
    const b = coarseIdx[t * 3 + 1];
    const c = coarseIdx[t * 3 + 2];
    const mAB = fineIdx[base + 1];
    const mCA = fineIdx[base + 2];
    const mBC = fineIdx[base + 4];
    const hasAB = splitEdges.has(edgeKey(a, b));
    const hasBC = splitEdges.has(edgeKey(b, c));
    const hasCA = splitEdges.has(edgeKey(c, a));
    const splitCount = hasAB + hasBC + hasCA;
    if (refined[t] || splitCount === 3) {
      for (let k = 0; k < 12; k++) {
        out.push(fineIdx[base + k]);
      }
    } else if (splitCount === 0) {
      out.push(a, b, c);
    } else if (splitCount === 1) {
      if (hasAB) {
        out.push(a, mAB, c, mAB, b, c);
      } else if (hasBC) {
        out.push(b, mBC, a, mBC, c, a);
      } else {
        out.push(c, mCA, b, mCA, a, b);
      }
    } else if (hasAB) {
      if (hasBC) {
        out.push(b, mBC, mAB, mBC, c, mAB, c, a, mAB);
      } else {
        out.push(a, mAB, mCA, mAB, b, mCA, b, c, mCA);
      }
    } else {
      out.push(c, mCA, mBC, mCA, a, mBC, a, b, mBC);
    }
  }
  return new Uint32Array(out);
}
