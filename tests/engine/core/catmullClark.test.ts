import { describe, expect, it } from "vitest";
import { catmullClark } from "../../../src/engine/geometry/catmullClark";
import type { QuadMesh } from "../../../src/engine/geometry/catmullClark";

const quadMesh = (values: number[], quads: number[], stride = 3): QuadMesh => ({
  values: new Float32Array(values),
  stride,
  quads: new Uint32Array(quads),
});

/** One quad over [0, 2]^2 in the xy plane, counter-clockwise seen from +z. */
const SQUARE = quadMesh([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0], [0, 1, 2, 3]);

/** Cube over [-1, 1]^3: vertex x + 2y + 4z (one bit per axis), quads counter-clockwise seen from outside. */
function cube(channels: (x: number, y: number, z: number) => number[] = () => []): QuadMesh {
  const values: number[] = [];
  for (let v = 0; v < 8; v++) {
    const x = v & 1 ? 1 : -1;
    const y = v & 2 ? 1 : -1;
    const z = v & 4 ? 1 : -1;
    values.push(x, y, z, ...channels(x, y, z));
  }
  const quads = [4, 5, 7, 6, 0, 2, 3, 1, 1, 3, 7, 5, 0, 4, 6, 2, 2, 6, 7, 3, 0, 1, 5, 4];
  return quadMesh(values, quads, values.length / 8);
}

/** Flat n x n quad grid over [0, n]^2 with z from `height`, counter-clockwise seen from +z. */
function grid(n: number, height: (i: number, j: number) => number = () => 0): QuadMesh {
  const values: number[] = [];
  const quads: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      values.push(i, j, height(i, j));
    }
  }
  const at = (i: number, j: number): number => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      quads.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  return quadMesh(values, quads);
}

const vertex = (mesh: QuadMesh, v: number): number[] => [
  ...mesh.values.subarray(v * mesh.stride, (v + 1) * mesh.stride),
];

/** Undirected edge "a-b" (a < b) -> number of quads using it. */
function quadEdgeCounts(quads: ArrayLike<number>): Map<string, number> {
  const counts = new Map<string, number>();
  for (let q = 0; q < quads.length; q += 4) {
    for (let k = 0; k < 4; k++) {
      const a = quads[q + k];
      const b = quads[q + ((k + 1) % 4)];
      const key = Math.min(a, b) + "-" + Math.max(a, b);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** Unnormalized normal of quad q (the cross product of its diagonals) and its centroid. */
function quadFrame(mesh: QuadMesh, q: number): { normal: number[]; center: number[] } {
  const [a, b, c, d] = [0, 1, 2, 3].map((k) => vertex(mesh, mesh.quads[q * 4 + k]));
  const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const v = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
  return {
    normal: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
    center: [0, 1, 2].map((axis) => (a[axis] + b[axis] + c[axis] + d[axis]) / 4),
  };
}

const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("catmullClark on an open mesh", () => {
  it("splits a single quad into four around its centroid", () => {
    const out = catmullClark(SQUARE);
    expect(out.stride).toBe(3);
    // Four old vertices, one point per edge in the order the quad meets them, then the face point.
    expect(out.values.length / 3).toBe(4 + 4 + 1);
    expect([4, 5, 6, 7].map((v) => vertex(out, v))).toEqual([
      [1, 0, 0],
      [2, 1, 0],
      [1, 2, 0],
      [0, 1, 0],
    ]);
    expect(vertex(out, 8)).toEqual([1, 1, 0]);
    expect([...out.quads]).toEqual([0, 4, 8, 7, 1, 5, 8, 4, 2, 6, 8, 5, 3, 7, 8, 6]);
  });

  it("rounds a border corner along the border curve: 3/4 of the vertex plus 1/8 of each border neighbor", () => {
    const out = catmullClark(SQUARE);
    expect([0, 1, 2, 3].map((v) => vertex(out, v))).toEqual([
      [0.25, 0.25, 0],
      [1.75, 0.25, 0],
      [1.75, 1.75, 0],
      [0.25, 1.75, 0],
    ]);
  });

  it("keeps a straight border where it is, whatever the inside does", () => {
    // 2 x 2 quads with the middle vertex raised.
    const mesh = grid(2, (i, j) => (i === 1 && j === 1 ? 1 : 0));
    const out = catmullClark(mesh);
    expect(out.values.length / 3).toBe(9 + 12 + 4);
    expect(out.quads.length / 4).toBe(16);
    for (const [v, i, j] of [
      [1, 1, 0],
      [3, 0, 1],
      [5, 2, 1],
      [7, 1, 2],
    ]) {
      expect(vertex(out, v)).toEqual([i, j, 0]);
    }
    expect(vertex(out, 0)).toEqual([0.125, 0.125, 0]);
    // Every vertex on a border edge stays in the border's plane, and inside the old outline.
    const borderVertices = new Set<number>();
    for (const [key, count] of quadEdgeCounts(out.quads)) {
      if (count === 1) {
        key.split("-").forEach((v) => borderVertices.add(Number(v)));
      }
    }
    expect(borderVertices.size).toBe(16);
    for (const v of borderVertices) {
      const [x, y, z] = vertex(out, v);
      expect(z).toBe(0);
      expect(x === 0 || x === 2 || y === 0 || y === 2 || v === 0 || v === 2 || v === 6 || v === 8).toBe(true);
    }
  });

  it("smooths an inner vertex toward its neighbors", () => {
    const mesh = grid(2, (i, j) => (i === 1 && j === 1 ? 1 : 0));
    const out = catmullClark(mesh);
    // (average of the face points + 2 * average of the edge midpoints + the vertex) / 4
    expect(vertex(out, 4)).toEqual([1, 1, (0.25 + 2 * 0.5 + 1) / 4]);
    // The inner edge from (1, 0, 0) to the middle: its midpoint averaged with the two face points next to it.
    const inner = [...Array(12).keys()].map((e) => vertex(out, 9 + e)).filter(([x, y]) => x === 1 && y === 0.5);
    expect(inner).toEqual([[1, 0.5, 0.375]]);
    // Face points.
    expect([21, 22, 23, 24].map((v) => vertex(out, v))).toEqual([
      [0.5, 0.5, 0.25],
      [1.5, 0.5, 0.25],
      [0.5, 1.5, 0.25],
      [1.5, 1.5, 0.25],
    ]);
  });

  it("leaves a vertex no quad uses where it is", () => {
    const out = catmullClark(quadMesh([...SQUARE.values, 5, 6, 7], [0, 1, 2, 3]));
    expect(out.values.length / 3).toBe(5 + 4 + 1);
    expect(vertex(out, 4)).toEqual([5, 6, 7]);
    expect(vertex(out, 9)).toEqual([1, 1, 0]);
  });

  it("does not modify its input and handles an empty mesh", () => {
    const mesh = grid(2, (i, j) => i * j);
    const values = [...mesh.values];
    const quads = [...mesh.quads];
    catmullClark(mesh);
    expect([...mesh.values]).toEqual(values);
    expect([...mesh.quads]).toEqual(quads);
    const empty = catmullClark(quadMesh([], []));
    expect([empty.values.length, empty.quads.length, empty.stride]).toEqual([0, 0, 3]);
  });
});

describe("catmullClark on a closed cube", () => {
  it("makes 26 vertices and 24 quads", () => {
    const out = catmullClark(cube());
    expect(out.values.length / 3).toBe(8 + 12 + 6);
    expect(out.quads.length / 4).toBe(24);
    expect(Math.max(...out.quads)).toBe(25);
  });

  it("pulls every corner toward the center by the same amount", () => {
    const mesh = cube();
    const out = catmullClark(mesh);
    for (let v = 0; v < 8; v++) {
      const before = vertex(mesh, v);
      const after = vertex(out, v);
      for (let axis = 0; axis < 3; axis++) {
        expect(after[axis]).toBeCloseTo((before[axis] * 5) / 9, 6);
      }
    }
  });

  it("places edge points at 3/4 of the edge midpoints and face points at the face centers", () => {
    const out = catmullClark(cube());
    const sorted = (v: number): number[] =>
      vertex(out, v)
        .map((c) => Math.round(Math.abs(c) * 1e6) / 1e6)
        .sort();
    const points = (from: number, to: number): string[] =>
      [...Array(to - from).keys()].map((i) => vertex(out, from + i).join(","));
    for (let v = 8; v < 20; v++) {
      expect(sorted(v)).toEqual([0, 0.75, 0.75]);
    }
    for (let v = 20; v < 26; v++) {
      expect(sorted(v)).toEqual([0, 0, 1]);
    }
    expect(new Set(points(8, 20)).size).toBe(12);
    expect(new Set(points(20, 26)).size).toBe(6);
  });

  it("stays symmetric under mirroring", () => {
    const out = catmullClark(catmullClark(cube()));
    const points = new Set<string>();
    const key = (p: number[]): string => p.map((c) => Math.round(c * 1e5) + 0).join(",");
    for (let v = 0; v < out.values.length / 3; v++) {
      points.add(key(vertex(out, v)));
    }
    expect(points.size).toBe(out.values.length / 3);
    for (let v = 0; v < out.values.length / 3; v++) {
      const [x, y, z] = vertex(out, v);
      expect(points.has(key([-x, y, z]))).toBe(true);
      expect(points.has(key([x, -y, z]))).toBe(true);
      expect(points.has(key([x, y, -z]))).toBe(true);
      expect(points.has(key([y, z, x]))).toBe(true);
    }
  });

  it("keeps the mesh closed over two steps", () => {
    let mesh = cube();
    for (const [vertices, quads] of [
      [26, 24],
      [98, 96],
    ]) {
      mesh = catmullClark(mesh);
      const edges = quadEdgeCounts(mesh.quads);
      expect(mesh.values.length / 3).toBe(vertices);
      expect(mesh.quads.length / 4).toBe(quads);
      expect(new Set(edges.values())).toEqual(new Set([2]));
      expect(new Set(mesh.quads).size).toBe(vertices);
      // Still a sphere: vertices - edges + faces = 2.
      expect(vertices - edges.size + quads).toBe(2);
    }
  });

  it("shrinks toward its limit surface without collapsing", () => {
    let mesh = cube();
    const radii = (m: QuadMesh): number[] =>
      [...Array(m.values.length / 3).keys()].map((v) => Math.hypot(...vertex(m, v)));
    mesh = catmullClark(mesh);
    const first = radii(mesh);
    mesh = catmullClark(mesh);
    const second = radii(mesh);
    expect(Math.max(...first)).toBeLessThan(Math.sqrt(3));
    expect(Math.max(...second)).toBeLessThan(Math.max(...first));
    expect(Math.min(...second)).toBeGreaterThan(0.75);
  });
});

describe("catmullClark children", () => {
  const meshes: [string, QuadMesh][] = [
    ["cube", cube()],
    ["bumpy grid", grid(3, (i, j) => Math.sin(i * 1.7) * Math.cos(j * 1.3) * 0.3)],
    ["subdivided cube", catmullClark(cube())],
  ];

  it.each(meshes)("puts the children of quad q of a %s at 4q to 4q + 3, each starting at an old corner", (_, mesh) => {
    const out = catmullClark(mesh);
    const vertexCount = mesh.values.length / mesh.stride;
    const quadCount = mesh.quads.length / 4;
    const edgeCount = quadEdgeCounts(mesh.quads).size;
    expect(out.values.length / mesh.stride).toBe(vertexCount + edgeCount + quadCount);
    for (let q = 0; q < quadCount; q++) {
      for (let k = 0; k < 4; k++) {
        const child = out.quads.subarray((q * 4 + k) * 4, (q * 4 + k) * 4 + 4);
        const next = out.quads.subarray((q * 4 + ((k + 1) % 4)) * 4, (q * 4 + ((k + 1) % 4)) * 4 + 4);
        expect(child[0]).toBe(mesh.quads[q * 4 + k]);
        expect(child[2]).toBe(vertexCount + edgeCount + q);
        // Edge points: between this corner and the next one, shared with the next child.
        expect(child[1]).toBe(next[3]);
        expect(child[1]).toBeGreaterThanOrEqual(vertexCount);
        expect(child[1]).toBeLessThan(vertexCount + edgeCount);
      }
    }
  });

  it.each(meshes)("uses one edge point for both quads at an edge of a %s", (_, mesh) => {
    const out = catmullClark(mesh);
    const edgePoint = new Map<string, number>();
    for (let q = 0; q < mesh.quads.length / 4; q++) {
      for (let k = 0; k < 4; k++) {
        const a = mesh.quads[q * 4 + k];
        const b = mesh.quads[q * 4 + ((k + 1) % 4)];
        const key = Math.min(a, b) + "-" + Math.max(a, b);
        const point = out.quads[(q * 4 + k) * 4 + 1];
        expect(edgePoint.get(key) ?? point).toBe(point);
        edgePoint.set(key, point);
      }
    }
    expect(new Set(edgePoint.values()).size).toBe(edgePoint.size);
  });

  it.each(meshes)("keeps the winding of a %s: children face the way their parent does", (_, mesh) => {
    const out = catmullClark(mesh);
    for (let q = 0; q < mesh.quads.length / 4; q++) {
      const parent = quadFrame(mesh, q).normal;
      for (let k = 0; k < 4; k++) {
        const child = quadFrame(out, q * 4 + k).normal;
        expect(dot(child, parent) / Math.hypot(...child) / Math.hypot(...parent)).toBeGreaterThan(0.5);
      }
    }
  });

  it("keeps a closed mesh facing outward over two steps", () => {
    const out = catmullClark(catmullClark(cube()));
    for (let q = 0; q < out.quads.length / 4; q++) {
      const { normal, center } = quadFrame(out, q);
      expect(dot(normal, center)).toBeGreaterThan(0);
    }
  });
});

describe("catmullClark extra channels", () => {
  const affine = (x: number, y: number, z: number): number => 2 * x - y + 0.5 * z + 3;

  it("subdivides the positions the same way with or without extra channels", () => {
    const plain = catmullClark(cube());
    const out = catmullClark(cube((x, y, z) => [7, affine(x, y, z)]));
    expect(out.stride).toBe(5);
    expect([...out.quads]).toEqual([...plain.quads]);
    for (let v = 0; v < 26; v++) {
      expect(vertex(out, v).slice(0, 3)).toEqual(vertex(plain, v));
    }
  });

  it("keeps a constant channel constant and an affine one affine, on closed and open meshes", () => {
    const open = grid(3, (i, j) => (i * j) / 4);
    const values: number[] = [];
    for (let v = 0; v < 16; v++) {
      const [x, y, z] = vertex(open, v);
      values.push(x, y, z, 7, affine(x, y, z));
    }
    for (const mesh of [cube((x, y, z) => [7, affine(x, y, z)]), quadMesh(values, [...open.quads], 5)]) {
      const out = catmullClark(catmullClark(mesh));
      for (let v = 0; v < out.values.length / 5; v++) {
        const [x, y, z, constant, linear] = vertex(out, v);
        expect(constant).toBeCloseTo(7, 5);
        expect(linear).toBeCloseTo(affine(x, y, z), 5);
      }
    }
  });

  it("keeps every channel within the range of its input", () => {
    // A 0-or-1 channel, like the forefoot's shade.
    const mesh = cube((x, y) => [x > 0 && y > 0 ? 1 : 0]);
    const out = catmullClark(catmullClark(mesh));
    const channel = [...Array(out.values.length / 4).keys()].map((v) => vertex(out, v)[3]);
    expect(Math.min(...channel)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...channel)).toBeLessThanOrEqual(1);
    // Blended in between rather than copied from the nearest corner.
    expect(new Set(channel.map((v) => Math.round(v * 1e4))).size).toBeGreaterThan(4);
    for (let v = 0; v < 8; v++) {
      const [x, y, , shade] = vertex(out, v);
      expect(shade > 0.5).toBe(x > 0 && y > 0);
    }
  });
});
