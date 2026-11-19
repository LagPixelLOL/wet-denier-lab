import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closestPointOnTriangle, closestPointOut } from "../../../src/engine/surface/closestPoint";
import { SurfaceGrid } from "../../../src/engine/surface/SurfaceGrid";
import type { SurfaceHit, SurfaceMesh, UvRect } from "../../../src/engine/surface/SurfaceGrid";
import { digestRounded } from "../../helpers/digest";
import { legModel } from "../../helpers/model";
import { seedRandom } from "../../helpers/random";

type Tri = [number[], number[], number[]];

const TRI: Tri = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];

function closest(p: number[], [a, b, c]: Tri): number[] {
  const out = new Float64Array(6);
  closestPointOnTriangle(p[0], p[1], p[2], a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], out);
  return [...out];
}

const round = (values: number[], decimals = 9): number[] =>
  values.map((v) => Math.round(v * 10 ** decimals) / 10 ** decimals + 0);

const copyHit = (hit: SurfaceHit | null): SurfaceHit | null => (hit ? { ...hit } : null);

describe("closestPointOnTriangle", () => {
  it.each([
    ["vertex A", [-1, -1, 0.5], [1, 0, 0]],
    ["vertex B", [2, -0.5, 0], [0, 1, 0]],
    ["vertex C", [-0.5, 2, 0], [0, 0, 1]],
    ["edge AB", [0.5, -1, 0.3], [0.5, 0.5, 0]],
    ["edge AC", [-1, 0.25, -2], [0.75, 0, 0.25]],
    ["edge BC", [1, 1, 0], [0, 0.5, 0.5]],
    ["interior", [0.25, 0.25, 2], [0.5, 0.25, 0.25]],
  ])("finds the %s region", (_region, p, weights) => {
    const out = closest(p, TRI);
    expect(round(out.slice(0, 3))).toEqual(weights);
    expect(round(out.slice(3))).toEqual([weights[1], weights[2], 0]);
  });

  it("writes into the shared scratch output", () => {
    closestPointOnTriangle(0.1, 0.1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, closestPointOut);
    expect(round([...closestPointOut])).toEqual([0.8, 0.1, 0.1, 0.1, 0.1, 0]);
  });

  describe("on random triangles", () => {
    let restore: () => void;
    beforeEach(() => {
      restore = seedRandom(5);
    });
    afterEach(() => restore());

    it("is never farther than any sampled point of the triangle", () => {
      const r = (): number => Math.random() * 2 - 1;
      for (let trial = 0; trial < 40; trial++) {
        const tri: Tri = [
          [r(), r(), r()],
          [r(), r(), r()],
          [r(), r(), r()],
        ];
        const p = [r() * 2, r() * 2, r() * 2];
        const out = closest(p, tri);
        expect(out[0] + out[1] + out[2]).toBeCloseTo(1, 12);
        expect(Math.min(out[0], out[1], out[2])).toBeGreaterThanOrEqual(-1e-12);
        const best = Math.hypot(p[0] - out[3], p[1] - out[4], p[2] - out[5]);
        let sampled = Infinity;
        const steps = 40;
        for (let i = 0; i <= steps; i++) {
          for (let j = 0; i + j <= steps; j++) {
            const wb = i / steps;
            const wc = j / steps;
            const wa = 1 - wb - wc;
            const q = [0, 1, 2].map((k) => wa * tri[0][k] + wb * tri[1][k] + wc * tri[2][k]);
            sampled = Math.min(sampled, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
          }
        }
        expect(best).toBeLessThanOrEqual(sampled + 1e-12);
        // And the sampling gets close to it (a 1/40 grid on a triangle of size ~2).
        expect(sampled - best).toBeLessThan(0.06);
      }
    });
  });
});

/** Two parallel 0.1 m squares facing +z: leg 0 at z = 0, leg 1 at z = 0.05, each its own UV island. */
function twoSquares(withRestY = true): SurfaceMesh & { pos: Float32Array } {
  const square = (z: number): number[] => [0, 0, z, 0.1, 0, z, 0.1, 0.1, z, 0, 0.1, z];
  const pos = new Float32Array([...square(0), ...square(0.05)]);
  const nrm = new Float32Array(24);
  for (let v = 0; v < 8; v++) {
    nrm[v * 3 + 2] = 1;
  }
  const uv = new Float32Array([0, 0, 0.5, 0, 0.5, 1, 0, 1, 0.5, 0, 1, 0, 1, 1, 0.5, 1]);
  const idx = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const ry = withRestY ? new Float32Array([10, 10, 20, 20, 30, 30, 40, 40]) : null;
  return { pos, nrm, uv, idx, ry, legTris: 2 };
}

describe("SurfaceGrid on a hand-made mesh", () => {
  it("finds UV islands and per-triangle UV bounds", () => {
    const grid = new SurfaceGrid(twoSquares());
    expect(grid.islandCount).toBe(2);
    expect([...grid.triIsland]).toEqual([0, 0, 1, 1]);
    expect([...grid.triUV.slice(0, 8)]).toEqual([0, 0, 0.5, 1, 0, 0, 0.5, 1]);
    expect(grid.active).toBe(4);
  });

  it("returns the closest point with interpolated normal, uv, rest height, leg and side", () => {
    const grid = new SurfaceGrid(twoSquares());
    const hit = copyHit(grid.closest(0.025, 0.05, -0.01));
    expect(hit).not.toBeNull();
    expect(round([hit!.x, hit!.y, hit!.z, hit!.nx, hit!.ny, hit!.nz, hit!.u, hit!.v, hit!.dist], 6)).toEqual([
      0.025, 0.05, 0, 0, 0, 1, 0.125, 0.5, 0.01,
    ]);
    expect([hit!.side, hit!.leg]).toEqual([-1, 0]);
    expect(hit!.ry).toBeCloseTo(15, 5);
    const front = grid.closest(0.05, 0.05, 0.06);
    expect([front?.leg, front?.side]).toEqual([1, 1]);
    expect(front?.tri).toBeGreaterThanOrEqual(2);
  });

  it("falls back to the hit height without rest heights and treats everything as leg 0 by default", () => {
    const { pos, nrm, uv, idx } = twoSquares(false);
    const grid = new SurfaceGrid({ pos, nrm, uv, idx });
    const hit = grid.closest(0.05, 0.02, 0.06, 0.05);
    expect(hit?.ry).toBeCloseTo(0.02, 6);
    expect(hit?.leg).toBe(0);
  });

  it("reports a zero normal (and the front side) where the mesh has no normals", () => {
    const mesh = twoSquares();
    const grid = new SurfaceGrid({ ...mesh, nrm: new Float32Array(24) });
    const hit = grid.closest(0.05, 0.05, -0.01);
    expect([hit?.nx, hit?.ny, hit?.nz, hit?.side]).toEqual([0, 0, 0, 1]);
  });

  it("returns null out of reach or out of bounds", () => {
    const grid = new SurfaceGrid(twoSquares());
    expect(grid.closest(0.05, 0.05, -0.03, 0.02)).toBeNull();
    expect(grid.closest(5, 5, 5)).toBeNull();
    expect(grid.inBounds(5, 0, 0)).toBe(false);
    expect(grid.inBounds(5, 0, 0, 10)).toBe(true);
  });

  it("clamps queries reaching past the grid", () => {
    const grid = new SurfaceGrid(twoSquares());
    const hit = grid.closest(0.05, 0.05, 0.3, 0.5);
    expect(hit?.z).toBeCloseTo(0.05, 6);
    expect(hit?.dist).toBeCloseTo(0.25, 6);
  });

  it("raycasts to the first hit and can skip a leg", () => {
    const grid = new SurfaceGrid(twoSquares());
    const first = copyHit(grid.raycast(0.03, 0.04, 1, 0, 0, -1));
    expect(first?.leg).toBe(1);
    expect(first?.t).toBeCloseTo(0.95, 6);
    expect(round([first!.x, first!.y, first!.u, first!.v], 6)).toEqual([0.03, 0.04, 0.65, 0.4]);
    expect(grid.raycast(0.03, 0.04, 1, 0, 0, -1, 10, 1)?.t).toBeCloseTo(1, 6);
    expect(grid.raycast(0.03, 0.04, 1, 0, 0, -1, 10, 0)?.leg).toBe(1);
    // Oblique ray.
    const oblique = grid.raycast(-0.05, 0.05, 0.15, 1, 0, -1);
    expect(oblique?.leg).toBe(1);
    expect(oblique?.x).toBeCloseTo(0.05, 6);
  });

  it("returns null for rays that miss", () => {
    const grid = new SurfaceGrid(twoSquares());
    // Too short.
    expect(grid.raycast(0.05, 0.05, 1, 0, 0, -1, 0.5)).toBeNull();
    // Axis-parallel outside the slab.
    expect(grid.raycast(5, 0.05, 1, 0, 0, -1)).toBeNull();
    // Missing the box.
    expect(grid.raycast(5, 5, 5, 1, 0, 0)).toBeNull();
    // Pointing away.
    expect(grid.raycast(0.05, 0.05, 1, 0, 0, 1)).toBeNull();
    // In the plane of leg 0 (parallel to every triangle).
    expect(grid.raycast(-0.02, 0.05, 0, 1, 0, 0)).toBeNull();
    // Inside the padded box but beside the squares.
    expect(grid.raycast(0.12, 0.05, 1, 0, 0, -1)).toBeNull();
    expect(grid.raycast(0.05, 0.12, 1, 0, 0, -1)).toBeNull();
    expect(grid.raycast(-0.01, 0.05, 1, 0, 0, -1)).toBeNull();
  });

  it("never reports a hit beyond maxT, even though the march overshoots by up to a cell", () => {
    const grid = new SurfaceGrid(twoSquares());
    expect(grid.raycast(0.05, 0.05, 1, 0, 0, -1, 0.95)?.t).toBeCloseTo(0.95, 6);
    expect(grid.raycast(0.05, 0.05, 1, 0, 0, -1, 0.945)).toBeNull();
    expect(grid.raycast(0.05, 0.05, 1, 0, 0, -1, 0.9)).toBeNull();
  });

  it("ignores hits behind the ray origin", () => {
    const grid = new SurfaceGrid(twoSquares());
    expect(grid.raycast(0.05, 0.05, 0.02, 0, 0, 1)?.t).toBeCloseTo(0.03, 6);
    expect(grid.raycast(0.05, 0.05, 0.02, 0, 0, 1, 10, 1)).toBeNull();
  });

  it("collects one UV rectangle per island touched by a sphere", () => {
    const grid = new SurfaceGrid(twoSquares());
    const out: UvRect[] = [[9, 9, 9, 9]];
    expect(grid.uvRects(0.05, 0.05, 0.025, 0.03, out)).toBe(out);
    expect(out).toEqual([
      [0, 0, 0.5, 1],
      [0.5, 0, 1, 1],
    ]);
    // Just behind leg 0: the cells around the sphere only hold leg 0's triangles.
    expect(grid.uvRects(0.05, 0.05, -0.008, 0.01, out)).toEqual([[0, 0, 0.5, 1]]);
    // Out of bounds, and in bounds but in cells no triangle overlaps.
    expect(grid.uvRects(0.05, 0.05, -0.3, 0.01, out)).toEqual([]);
    expect(grid.uvRects(0.05, 0.05, -0.04, 0.005, out)).toEqual([]);
  });

  it("can index only the first triangles and follows positions updated in place", () => {
    const mesh = twoSquares();
    const grid = new SurfaceGrid(mesh);
    const cellTris = grid.cellTris;
    grid.rebuild(2);
    expect(grid.active).toBe(2);
    expect(grid.raycast(0.05, 0.05, 1, 0, 0, -1)?.leg).toBe(0);
    expect(grid.cellTris).toBe(cellTris);

    for (let v = 4; v < 8; v++) {
      mesh.pos[v * 3 + 2] = 0.2;
    }
    grid.rebuild();
    expect(grid.raycast(0.05, 0.05, 1, 0, 0, -1)?.t).toBeCloseTo(0.8, 6);
    const cellStart = grid.cellStart;
    grid.rebuild();
    expect(grid.cellStart).toBe(cellStart);
    expect(grid.closest(0.05, 0.05, 0.19)?.leg).toBe(1);
  });

  it("leaves skipped triangles out of every query until they are indexed again", () => {
    const grid = new SurfaceGrid(twoSquares());
    const front = grid.max[2];
    expect([...grid.skip]).toEqual([0, 0, 0, 0]);
    // Marking alone changes nothing: the mask is read by rebuild().
    grid.skip.fill(1, 2);
    expect(grid.raycast(0.05, 0.05, 1, 0, 0, -1)?.leg).toBe(1);
    grid.rebuild();
    expect(grid.active).toBe(4);
    const through = copyHit(grid.raycast(0.05, 0.05, 1, 0, 0, -1));
    expect([through?.leg, through?.tri]).toEqual([0, expect.any(Number)]);
    expect(through?.t).toBeCloseTo(1, 6);
    // Right in front of leg 1, the closest point is on leg 0 behind it, or out of reach.
    expect(grid.closest(0.05, 0.05, 0.06, 0.1)?.z).toBeCloseTo(0, 6);
    expect(grid.closest(0.05, 0.05, 0.06, 0.02)).toBeNull();
    const out: UvRect[] = [];
    expect(grid.uvRects(0.05, 0.05, 0.025, 0.03, out)).toEqual([[0, 0, 0.5, 1]]);
    // The grid only spans what it indexes.
    expect(grid.max[2]).toBeCloseTo(front - 0.05, 6);

    // One triangle of a square: only its half is left out.
    grid.skip.fill(0);
    grid.skip[2] = 1;
    grid.rebuild();
    expect(grid.raycast(0.07, 0.03, 1, 0, 0, -1)?.leg).toBe(0);
    expect(grid.raycast(0.03, 0.07, 1, 0, 0, -1)?.tri).toBe(3);

    grid.skip.fill(0);
    grid.rebuild();
    expect(grid.raycast(0.07, 0.03, 1, 0, 0, -1)?.tri).toBe(2);
    expect(grid.closest(0.05, 0.05, 0.06, 0.02)?.leg).toBe(1);
    expect(grid.uvRects(0.05, 0.05, 0.025, 0.03, out).length).toBe(2);
  });

  it("applies the skip mask within the triangles that rebuild() indexes", () => {
    const grid = new SurfaceGrid(twoSquares());
    grid.skip[0] = 1;
    grid.skip[3] = 1;
    grid.rebuild(2);
    expect(grid.active).toBe(2);
    // Leg 1 is not indexed at all, and of leg 0 only the second triangle is.
    expect(grid.raycast(0.07, 0.03, 1, 0, 0, -1)).toBeNull();
    expect(grid.raycast(0.03, 0.07, 1, 0, 0, -1)?.tri).toBe(1);
    grid.rebuild();
    expect(grid.active).toBe(4);
    expect(grid.raycast(0.07, 0.03, 1, 0, 0, -1)?.tri).toBe(2);
    expect(grid.raycast(0.03, 0.07, 1, 0, 0, -1)?.tri).toBe(1);
    expect(grid.raycast(0.03, 0.07, 1, 0, 0, -1, 10, 0)).toBeNull();
    // The mask survives a rebuild of fewer triangles and back.
    grid.rebuild(2);
    grid.rebuild();
    expect(grid.raycast(0.07, 0.03, 0.03, 0, 0, -1)).toBeNull();
    expect(grid.closest(0.07, 0.03, 0.01, 0.05)?.tri).toBe(1);
  });

  it("puts triangles into the UV island of the triangle they name", () => {
    // Leg 1's square borrows the UVs of leg 0's: one island, although the squares share no vertex.
    const mesh = twoSquares();
    const grid = new SurfaceGrid({
      ...mesh,
      uv: new Float32Array([0, 0, 0.5, 0, 0.5, 1, 0, 1, 0.1, 0, 0.6, 0, 0.6, 1, 0.1, 1]),
      islandOf: [-1, -1, 0, 1],
    });
    expect(grid.islandCount).toBe(1);
    expect([...grid.triIsland]).toEqual([0, 0, 0, 0]);
    const out: UvRect[] = [];
    expect(grid.uvRects(0.05, 0.05, 0.025, 0.03, out).map((rect) => round(rect, 6))).toEqual([[0, 0, 0.6, 1]]);
    // Only the named triangles join another island.
    const half = new SurfaceGrid({ ...mesh, islandOf: [-1, -1, 0, -1] });
    expect(half.islandCount).toBe(2);
    expect([...half.triIsland]).toEqual([0, 0, 0, 1]);
    expect(new SurfaceGrid({ ...mesh, islandOf: null }).islandCount).toBe(2);
  });
});

/** Brute-force closest distance over every triangle. */
function bruteClosest(mesh: SurfaceMesh, p: number[]): { dist: number; tri: number } {
  const { pos, idx } = mesh;
  const out = new Float64Array(6);
  let best = Infinity;
  let bestTri = -1;
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    closestPointOnTriangle(
      p[0],
      p[1],
      p[2],
      pos[a],
      pos[a + 1],
      pos[a + 2],
      pos[b],
      pos[b + 1],
      pos[b + 2],
      pos[c],
      pos[c + 1],
      pos[c + 2],
      out,
    );
    const d = Math.hypot(p[0] - out[3], p[1] - out[4], p[2] - out[5]);
    if (d < best) {
      best = d;
      bestTri = t;
    }
  }
  return { dist: best, tri: bestTri };
}

/** Brute-force Moller-Trumbore over every triangle, with the grid's acceptance rules. */
function bruteRaycast(mesh: SurfaceMesh, o: number[], d: number[]): number | null {
  const { pos, idx } = mesh;
  let best = Infinity;
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
    if (Math.abs(det) < 1e-12) {
      continue;
    }
    const s = [o[0] - pos[a], o[1] - pos[a + 1], o[2] - pos[a + 2]];
    const u = (s[0] * pv[0] + s[1] * pv[1] + s[2] * pv[2]) / det;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    const th = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (u >= 0 && u <= 1 && v >= 0 && u + v <= 1 && th > 0.00001 && th < best) {
      best = th;
    }
  }
  return best === Infinity ? null : best;
}

describe("SurfaceGrid on the real collision mesh", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = seedRandom(99);
  });
  afterEach(() => restore());

  let grid: SurfaceGrid | undefined;
  const meshGrid = (): SurfaceGrid => (grid ??= new SurfaceGrid(legModel().collision));

  /** Random points near the surface: a random vertex pushed off along a random direction. */
  function probes(count: number, spread: number): number[][] {
    const { pos } = legModel().collision;
    const n = pos.length / 3;
    return Array.from({ length: count }, () => {
      const v = Math.floor(Math.random() * n);
      return [0, 1, 2].map((k) => pos[v * 3 + k] + (Math.random() * 2 - 1) * spread);
    });
  }

  it("indexes the whole stocking as one leg", () => {
    const g = meshGrid();
    expect(g.triCount).toBe(legModel().collision.idx.length / 3);
    expect([g.islandCount, g.dims]).toMatchInlineSnapshot(`
      [
        2,
        [
          22,
          80,
          30,
        ],
      ]
    `);
  });

  it("agrees with brute force on closest points", () => {
    const g = meshGrid();
    const mesh = legModel().collision;
    const results: number[] = [];
    for (const p of probes(24, 0.02)) {
      const brute = bruteClosest(mesh, p);
      const hit = g.closest(p[0], p[1], p[2], 0.015);
      if (brute.dist < 0.015) {
        expect(hit).not.toBeNull();
        expect(hit!.dist).toBeCloseTo(brute.dist, 9);
        results.push(hit!.dist, hit!.u, hit!.v, hit!.side);
      } else {
        expect(hit).toBeNull();
        results.push(-1);
      }
    }
    expect(results.filter((v) => v !== -1).length).toBeGreaterThan(24);
    expect(digestRounded(results, 7)).toMatchInlineSnapshot(`"52fca4d7"`);
  });

  it("agrees with brute force on raycasts", () => {
    const g = meshGrid();
    const mesh = legModel().collision;
    const hits: number[] = [];
    const targets = probes(32, 0.005);
    for (const [i, p] of probes(32, 0.08).entries()) {
      // Half the rays aim at a point near the surface, the others go anywhere.
      const theta = Math.random() * Math.PI * 2;
      const dir =
        i % 2 ? targets[i].map((v, k) => v - p[k]) : [Math.cos(theta), Math.random() * 0.6 - 0.3, Math.sin(theta)];
      const len = Math.hypot(dir[0], dir[1], dir[2]);
      const d = dir.map((v) => v / len);
      const expected = bruteRaycast(mesh, p, d);
      const hit = g.raycast(p[0], p[1], p[2], d[0], d[1], d[2], 0.5);
      if (expected !== null && expected <= 0.5) {
        expect(hit?.t).toBeCloseTo(expected, 9);
        hits.push(hit!.t);
      } else {
        expect(hit).toBeNull();
      }
    }
    expect(hits.length).toBeGreaterThan(20);
    expect(digestRounded(hits, 7)).toMatchInlineSnapshot(`"00eb890b"`);
  });

  it("returns UV rectangles that cover every triangle the sphere touches", () => {
    const g = meshGrid();
    const mesh = legModel().collision;
    const { pos, idx, uv } = mesh;
    const out: UvRect[] = [];
    const scratch = new Float64Array(6);
    for (const p of probes(8, 0.01)) {
      const radius = 0.015;
      g.uvRects(p[0], p[1], p[2], radius, out);
      expect(out.length).toBeGreaterThan(0);
      for (let t = 0; t < idx.length / 3; t++) {
        const a = idx[t * 3];
        const b = idx[t * 3 + 1];
        const c = idx[t * 3 + 2];
        closestPointOnTriangle(
          p[0],
          p[1],
          p[2],
          pos[a * 3],
          pos[a * 3 + 1],
          pos[a * 3 + 2],
          pos[b * 3],
          pos[b * 3 + 1],
          pos[b * 3 + 2],
          pos[c * 3],
          pos[c * 3 + 1],
          pos[c * 3 + 2],
          scratch,
        );
        if (Math.hypot(p[0] - scratch[3], p[1] - scratch[4], p[2] - scratch[5]) > radius) {
          continue;
        }
        const us = [uv[a * 2], uv[b * 2], uv[c * 2]];
        const vs = [uv[a * 2 + 1], uv[b * 2 + 1], uv[c * 2 + 1]];
        const covered = out.some(
          (r) =>
            r[0] <= Math.min(...us) && r[1] <= Math.min(...vs) && r[2] >= Math.max(...us) && r[3] >= Math.max(...vs),
        );
        expect(covered).toBe(true);
      }
    }
  });
});
