/** Small hand-made meshes and mesh-inspection utilities shared by the core engine tests. */
import type { ModelData } from "../../../src/engine/model/glb";

export interface TestMesh {
  pos: Float32Array;
  uv: Float32Array;
  idx: Uint32Array;
}

/** Flat n x n quad grid in the xy plane (z = 0) over [0, n]^2, two counter-clockwise triangles per quad. */
export function flatGrid(n: number, flipDiagonals = false): TestMesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      pos.push(i, j, 0);
      uv.push(i / n, j / n);
    }
  }
  const at = (i: number, j: number): number => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      if (flipDiagonals !== ((i + j) % 2 === 1)) {
        idx.push(a, b, d, b, c, d);
      } else {
        idx.push(a, b, c, a, c, d);
      }
    }
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint32Array(idx) };
}

/** Closed open-ended tube (a cylinder without caps) around the y axis: `rings` rows of `segments` vertices. */
export function tube(
  radius: number,
  y0: number,
  y1: number,
  rings: number,
  segments: number,
  cx = 0,
  cz = 0,
): TestMesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r < rings; r++) {
    const y = y0 + ((y1 - y0) * r) / (rings - 1);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius);
      uv.push(s / segments, r / (rings - 1));
    }
  }
  for (let r = 0; r + 1 < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * segments + s;
      const b = r * segments + ((s + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint32Array(idx) };
}

/** A tiny ModelData (a thin tube as the stocking, a short tube as the skin top) that builds in milliseconds. */
export function tinyModelData(): ModelData {
  const stocking = tube(0.05, 0.02, 0.9, 12, 8);
  const skin = tube(0.06, 0.9, 1.0, 3, 8);
  return {
    stocking: { positions: stocking.pos, uvs: stocking.uv, indices: stocking.idx },
    skinTop: { positions: skin.pos, indices: skin.idx },
  };
}

const EDGE_KEY_SCALE = 2097152;

/** Undirected edge (key a * 2^21 + b with a < b) -> number of triangles using it, after mapping through `weld`. */
export function edgeCounts(idx: ArrayLike<number>, weld?: ArrayLike<number>): Map<number, number> {
  const counts = new Map<number, number>();
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      let a = idx[t + k];
      let b = idx[t + ((k + 1) % 3)];
      if (weld) {
        a = weld[a];
        b = weld[b];
      }
      const key = a < b ? a * EDGE_KEY_SCALE + b : b * EDGE_KEY_SCALE + a;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** The two vertices of an edge key. */
export const edgeVertices = (key: number): [number, number] => [Math.floor(key / EDGE_KEY_SCALE), key % EDGE_KEY_SCALE];

/** Edges used an odd number of times (the open boundary of a mesh, plus any cracks), sorted. */
export function oddEdges(idx: ArrayLike<number>, weld?: ArrayLike<number>): number[] {
  return [...edgeCounts(idx, weld)]
    .filter(([, n]) => n % 2 === 1)
    .map(([key]) => key)
    .sort((x, y) => x - y);
}

/** Signed z component of the area of each triangle (positive = counter-clockwise seen from +z). */
export function signedAreasZ(pos: ArrayLike<number>, idx: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    out.push(((pos[b] - pos[a]) * (pos[c + 1] - pos[a + 1]) - (pos[b + 1] - pos[a + 1]) * (pos[c] - pos[a])) / 2);
  }
  return out;
}

export interface GlbAccessorInput {
  data: Int16Array | Uint16Array | Uint32Array | Float32Array;
  componentType: 5122 | 5123 | 5125 | 5126;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
  /** Zero bytes written at the start of the buffer view, skipped through the accessor's byteOffset. */
  pad?: number;
}

/**
 * Minimal glTF 2.0 binary writer: each accessor gets its own buffer view (the first one without an explicit
 * byteOffset), and `json` is merged with the generated accessors/bufferViews.
 */
export function buildGlb(
  accessors: GlbAccessorInput[],
  meshes: unknown[],
  { magic = 0x46546c67, version = 2 }: { magic?: number; version?: number } = {},
): ArrayBuffer {
  const views: { byteOffset?: number }[] = [];
  const accessorJson: object[] = [];
  let binLength = 0;
  for (const accessor of accessors) {
    binLength = Math.ceil(binLength / 4) * 4;
    views.push(binLength === 0 ? {} : { byteOffset: binLength });
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
    const pad = accessor.pad ?? 0;
    accessorJson.push({
      bufferView: views.length - 1,
      ...(pad ? { byteOffset: pad } : {}),
      componentType: accessor.componentType,
      count: accessor.data.length / components,
      type: accessor.type,
    });
    binLength += pad + accessor.data.byteLength;
  }
  binLength = Math.ceil(binLength / 4) * 4;
  let jsonText = JSON.stringify({ accessors: accessorJson, bufferViews: views, meshes });
  while (jsonText.length % 4) {
    jsonText += " ";
  }
  const jsonBytes = new TextEncoder().encode(jsonText);
  const total = 12 + 8 + jsonBytes.length + 8 + binLength;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, version, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, jsonBytes.length).set(jsonBytes);
  const binStart = 20 + jsonBytes.length;
  view.setUint32(binStart, binLength, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  let offset = 0;
  for (const accessor of accessors) {
    offset = Math.ceil(offset / 4) * 4 + (accessor.pad ?? 0);
    new Uint8Array(buffer, binStart + 8 + offset, accessor.data.byteLength).set(
      new Uint8Array(accessor.data.buffer, accessor.data.byteOffset, accessor.data.byteLength),
    );
    offset += accessor.data.byteLength;
  }
  return buffer;
}

/** A tiny but complete leg-model .glb built from tinyModelData(), optionally with wrap offsets. */
export function tinyGlb(wrap?: Int16Array): ArrayBuffer {
  const data = tinyModelData();
  const accessors: GlbAccessorInput[] = [
    { data: data.stocking.positions as Float32Array, componentType: 5126, type: "VEC3" },
    { data: data.stocking.uvs as Float32Array, componentType: 5126, type: "VEC2", pad: 8 },
    { data: Uint16Array.from(data.stocking.indices), componentType: 5123, type: "SCALAR" },
    { data: data.skinTop.positions as Float32Array, componentType: 5126, type: "VEC3" },
    { data: data.skinTop.indices as Uint32Array, componentType: 5125, type: "SCALAR" },
  ];
  if (wrap) {
    accessors.push({ data: wrap, componentType: 5122, type: "VEC4" });
  }
  return buildGlb(accessors, [
    { name: "skinTop", primitives: [{ attributes: { POSITION: 3 }, indices: 4 }] },
    {
      name: "stocking",
      primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2 }],
      ...(wrap ? { extras: { wrapOffsets: { accessor: 5 } } } : {}),
    },
  ]);
}

/** Every index in range and no triangle repeating a vertex. */
export function topologyProblems(idx: ArrayLike<number>, vertexCount: number): string[] {
  const problems: string[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) {
      problems.push("out of range at " + t / 3);
    }
    if (a === b || b === c || a === c) {
      problems.push("degenerate at " + t / 3);
    }
  }
  return problems;
}
