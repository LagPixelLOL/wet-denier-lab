/**
 * Catmull-Clark subdivision of a quad mesh, used to turn the forefoot's control cage into a smooth surface.
 */

/** A quad mesh with `stride` values per vertex: x, y, z, then anything that should subdivide along with them. */
export interface QuadMesh {
  values: Float32Array;
  stride: number;
  quads: Uint32Array;
}

/**
 * One subdivision step: every quad becomes four. The old vertices come first (moved), then one point per edge,
 * then one per face; the four children of quad q are quads 4q to 4q + 3. Open borders keep their shape.
 */
export function catmullClark({ values, stride, quads }: QuadMesh): QuadMesh {
  const vertexCount = values.length / stride;
  const faceCount = quads.length / 4;
  const facePoints = new Float32Array(faceCount * stride);
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 4; k++) {
      const v = quads[f * 4 + k];
      for (let c = 0; c < stride; c++) {
        facePoints[f * stride + c] += values[v * stride + c] / 4;
      }
    }
  }
  // Edges, in the order the quads meet them.
  const edgeOf = new Map<number, number>();
  const cornerEdge = new Uint32Array(faceCount * 4);
  const ends: number[] = [];
  const faceSums: number[] = [];
  const faceCounts: number[] = [];
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 4; k++) {
      const a = quads[f * 4 + k];
      const b = quads[f * 4 + ((k + 1) % 4)];
      const key = a < b ? a * vertexCount + b : b * vertexCount + a;
      let edge = edgeOf.get(key);
      if (edge === undefined) {
        edge = ends.length / 2;
        edgeOf.set(key, edge);
        ends.push(a, b);
        faceCounts.push(0);
        for (let c = 0; c < stride; c++) {
          faceSums.push(0);
        }
      }
      cornerEdge[f * 4 + k] = edge;
      faceCounts[edge]++;
      for (let c = 0; c < stride; c++) {
        faceSums[edge * stride + c] += facePoints[f * stride + c];
      }
    }
  }
  const edgeCount = ends.length / 2;
  const out = new Float32Array((vertexCount + edgeCount + faceCount) * stride);
  out.set(facePoints, (vertexCount + edgeCount) * stride);
  // Per vertex: sums of the midpoints of its edges, of its border edges only, and of its faces' points.
  const midSums = new Float32Array(vertexCount * stride);
  const borderSums = new Float32Array(vertexCount * stride);
  const faceAvg = new Float32Array(vertexCount * stride);
  const edgeValence = new Uint16Array(vertexCount);
  const borderValence = new Uint16Array(vertexCount);
  const faceValence = new Uint16Array(vertexCount);
  for (let e = 0; e < edgeCount; e++) {
    const a = ends[e * 2];
    const b = ends[e * 2 + 1];
    const border = faceCounts[e] === 1;
    edgeValence[a]++;
    edgeValence[b]++;
    if (border) {
      borderValence[a]++;
      borderValence[b]++;
    }
    for (let c = 0; c < stride; c++) {
      const mid = (values[a * stride + c] + values[b * stride + c]) / 2;
      midSums[a * stride + c] += mid;
      midSums[b * stride + c] += mid;
      if (border) {
        borderSums[a * stride + c] += mid;
        borderSums[b * stride + c] += mid;
      }
      out[(vertexCount + e) * stride + c] = border ? mid : (mid * 2 + faceSums[e * stride + c]) / 4;
    }
  }
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 4; k++) {
      const v = quads[f * 4 + k];
      faceValence[v]++;
      for (let c = 0; c < stride; c++) {
        faceAvg[v * stride + c] += facePoints[f * stride + c];
      }
    }
  }
  for (let v = 0; v < vertexCount; v++) {
    const n = faceValence[v];
    for (let c = 0; c < stride; c++) {
      const i = v * stride + c;
      if (borderValence[v]) {
        // Border vertices follow the border curve only.
        out[i] = 0.5 * values[i] + (0.5 * borderSums[i]) / borderValence[v];
      } else if (n) {
        out[i] = (faceAvg[i] / n + (2 * midSums[i]) / edgeValence[v] + (n - 3) * values[i]) / n;
      } else {
        out[i] = values[i];
      }
    }
  }
  const outQuads = new Uint32Array(faceCount * 16);
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 4; k++) {
      outQuads.set(
        [
          quads[f * 4 + k],
          vertexCount + cornerEdge[f * 4 + k],
          vertexCount + edgeCount + f,
          vertexCount + cornerEdge[f * 4 + ((k + 3) % 4)],
        ],
        (f * 4 + k) * 4,
      );
    }
  }
  return { values: out, stride, quads: outQuads };
}
