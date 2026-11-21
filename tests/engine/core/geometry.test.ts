import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sliceAtHeights } from "../../../src/engine/geometry/slice";
import { buildAdaptiveIndex, subdivideSmooth } from "../../../src/engine/geometry/subdivide";
import { buildGeometry, computeWeldedNormals, weldVertices } from "../../../src/engine/geometry/weld";
import { digest } from "../../helpers/digest";
import { legModel, modelData } from "../../helpers/model";
import { seedRandom } from "../../helpers/random";
import { edgeCounts, edgeVertices, flatGrid, oddEdges, signedAreasZ, topologyProblems, tube } from "./fixtures";

const OCTAHEDRON = {
  pos: new Float32Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]),
  idx: new Uint32Array([0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5]),
};

describe("weldVertices", () => {
  it("maps every vertex to the first vertex at the same position", () => {
    const weld = weldVertices([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 2, 2, 2]);
    expect([...weld]).toEqual([0, 1, 0, 1, 4]);
  });

  it("rounds positions to a 1e-5 grid before comparing", () => {
    const weld = weldVertices([0.5, 0.25, -1, 0.500004, 0.25, -1.000004, 0.500006, 0.25, -1]);
    expect([...weld]).toEqual([0, 0, 2]);
  });

  it("returns an empty map for an empty mesh", () => {
    expect(weldVertices([]).length).toBe(0);
  });
});

describe("computeWeldedNormals", () => {
  it("gives a flat counter-clockwise triangle the +z normal at every corner", () => {
    const normals = computeWeldedNormals([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], [0, 1, 2]);
    expect([...normals]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it("shares one smooth normal across a UV seam (duplicated vertices)", () => {
    // A roof: two faces meeting at the ridge x = 0, the ridge vertices duplicated per face.
    const pos = [0, 0, 1, 0, 1, 1, -1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0];
    const idx = [0, 1, 2, 3, 5, 4];
    const unwelded = computeWeldedNormals(pos, idx, [0, 1, 2, 3, 4, 5]);
    const welded = computeWeldedNormals(pos, idx, weldVertices(pos));
    expect(unwelded[0]).not.toBeCloseTo(unwelded[9]);
    for (const ridge of [0, 1, 3, 4]) {
      expect(welded[ridge * 3]).toBeCloseTo(0, 6);
      expect(welded[ridge * 3 + 1]).toBeCloseTo(0, 6);
      expect(welded[ridge * 3 + 2]).toBeCloseTo(1, 6);
    }
    // Non-ridge corners keep their own face normal.
    expect(welded[2 * 3]).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(welded[5 * 3]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("weights faces by area", () => {
    // Big triangle facing +z and a small one facing +x sharing vertex 0.
    const pos = [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1];
    const n = computeWeldedNormals(pos, [0, 1, 2, 3, 4, 5], weldVertices(pos));
    expect(n[0] / n[2]).toBeCloseTo(1 / 4, 6);
  });

  it("leaves unused vertices with a zero normal instead of NaN", () => {
    const n = computeWeldedNormals([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5], [0, 1, 2], [0, 1, 2, 3]);
    expect([...n.slice(9)]).toEqual([0, 0, 0]);
  });
});

describe("buildGeometry", () => {
  it("creates position, normal, uv and index attributes with bounds", () => {
    const grid = flatGrid(2);
    const geometry = buildGeometry(grid.pos, grid.uv, grid.idx);
    expect(Object.keys(geometry.attributes).sort()).toEqual(["normal", "position", "uv"]);
    expect(geometry.index?.count).toBe(grid.idx.length);
    expect(geometry.attributes.normal.getZ(4)).toBe(1);
    expect(geometry.boundingBox?.max.toArray()).toEqual([2, 2, 0]);
    expect(geometry.boundingSphere?.radius).toBeCloseTo(Math.SQRT2, 6);
  });

  it("omits the uv attribute when no uvs are given and honours an explicit weld", () => {
    const grid = flatGrid(1);
    const geometry = buildGeometry(grid.pos, null, grid.idx, [0, 1, 2, 3]);
    expect(geometry.attributes.uv).toBeUndefined();
  });
});

describe("subdivideSmooth", () => {
  it("splits a flat triangle into four with exact edge midpoints", () => {
    const out = subdivideSmooth([0, 0, 0, 2, 0, 0, 0, 2, 0], [0, 0, 1, 0, 0, 1], [0, 1, 2]);
    expect([...out.pos]).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect([...out.uv]).toEqual([0, 0, 1, 0, 0, 1, 0.5, 0, 0.5, 0.5, 0, 0.5]);
    // Corner triangles first, then the middle one, all keeping the winding.
    expect([...out.idx]).toEqual([0, 3, 5, 1, 4, 3, 2, 5, 4, 3, 4, 5]);
    expect(signedAreasZ(out.pos, out.idx)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("creates one midpoint per shared edge", () => {
    const grid = flatGrid(3);
    const out = subdivideSmooth(grid.pos, grid.uv, grid.idx);
    expect(out.pos.length / 3).toBe(16 + edgeCounts(grid.idx).size);
    expect(out.idx.length).toBe(grid.idx.length * 4);
    expect(topologyProblems(out.idx, out.pos.length / 3)).toEqual([]);
    expect(signedAreasZ(out.pos, out.idx).every((a) => a === 0.125)).toBe(true);
  });

  it("returns null uvs when none are given", () => {
    const out = subdivideSmooth([0, 0, 0, 1, 0, 0, 0, 1, 0], null, [0, 1, 2]);
    expect(out.uv).toBeNull();
    expect(out.pos.length).toBe(18);
  });

  it("bulges midpoints of a curved mesh outward along the smooth normals", () => {
    const out = subdivideSmooth(OCTAHEDRON.pos, null, OCTAHEDRON.idx);
    expect(out.pos.length / 3).toBe(6 + 12);
    const radii = new Set<number>();
    for (let v = 6; v < 18; v++) {
      radii.add(Math.round(Math.hypot(out.pos[v * 3], out.pos[v * 3 + 1], out.pos[v * 3 + 2]) * 1e6) / 1e6);
    }
    // Every midpoint moves the same amount, from the chord (0.7071) towards the unit sphere.
    expect([...radii]).toMatchInlineSnapshot(`
      [
        0.972272,
      ]
    `);
  });

  it("places seam midpoints from welded positions but keeps per-side uvs", () => {
    // Two triangles sharing an edge through duplicated vertices (0 = 3, 1 = 4) with different uvs.
    const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, -1, 0];
    const uv = [0, 0, 1, 0, 0, 1, 0.5, 0.5, 0.75, 0.5, 1, 1];
    const out = subdivideSmooth(pos, uv, [0, 1, 2, 4, 3, 5]);
    expect(out.pos.length / 3).toBe(12);
    const abFirst = out.idx[1];
    const abSecond = out.idx[13];
    expect(abFirst).not.toBe(abSecond);
    expect([...out.pos.slice(abFirst * 3, abFirst * 3 + 3)]).toEqual([
      ...out.pos.slice(abSecond * 3, abSecond * 3 + 3),
    ]);
    expect([out.uv[abFirst * 2], out.uv[abSecond * 2]]).toEqual([0.5, 0.625]);
  });
});

/** Coarse mesh, its subdivision and a per-vertex "height" array that selects which triangles are refined. */
function adaptiveFixture(
  coarse: { pos: Float32Array; uv: Float32Array; idx: Uint32Array },
  low: (v: number) => boolean,
) {
  const fine = subdivideSmooth(coarse.pos, coarse.uv, coarse.idx);
  const heights = new Float32Array(fine.pos.length);
  for (let v = 0; v < coarse.pos.length / 3; v++) {
    heights[v * 3 + 1] = low(v) ? 0 : 1;
  }
  const identity = Int32Array.from({ length: fine.pos.length / 3 }, (_, i) => i);
  const out = buildAdaptiveIndex(coarse.idx, fine.idx, heights, identity, 0.5);
  return { fine, out };
}

function expectCrackFree(fine: { pos: Float32Array }, out: Uint32Array, size: number): void {
  const areas = signedAreasZ(fine.pos, out);
  expect(areas.every((a) => a > 0)).toBe(true);
  expect(areas.reduce((s, a) => s + a, 0)).toBeCloseTo(size * size, 9);
  // Only the outer square may be an open boundary: any other odd edge would be a T-junction crack.
  const onSameSide = (key: number): boolean => {
    const [a, b] = edgeVertices(key);
    const ax = fine.pos[a * 3];
    const ay = fine.pos[a * 3 + 1];
    const bx = fine.pos[b * 3];
    const by = fine.pos[b * 3 + 1];
    return (ax === bx && (ax === 0 || ax === size)) || (ay === by && (ay === 0 || ay === size));
  };
  const boundary = oddEdges(out);
  expect(boundary.filter((key) => !onSameSide(key))).toEqual([]);
  expect(Math.max(...edgeCounts(out).values())).toBeLessThanOrEqual(2);
}

describe("buildAdaptiveIndex", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = seedRandom(7);
  });
  afterEach(() => restore());

  it("keeps the coarse index when nothing is below maxY", () => {
    const grid = flatGrid(2);
    const { out } = adaptiveFixture(grid, () => false);
    expect([...out]).toEqual([...grid.idx]);
  });

  it("uses the fine index everywhere when everything is below maxY", () => {
    const grid = flatGrid(2);
    const { fine, out } = adaptiveFixture(grid, () => true);
    expect([...out]).toEqual([...fine.idx]);
  });

  it("refines only triangles with a corner strictly below maxY", () => {
    const fine = subdivideSmooth([0, 0, 0, 1, 0, 0, 0, 1, 0], null, [0, 1, 2]);
    const heights = new Float32Array(fine.pos.length).fill(0.5);
    expect(buildAdaptiveIndex([0, 1, 2], fine.idx, heights, [0, 1, 2, 3, 4, 5], 0.5).length).toBe(3);
    heights[1] = 0.4999;
    expect(buildAdaptiveIndex([0, 1, 2], fine.idx, heights, [0, 1, 2, 3, 4, 5], 0.5).length).toBe(12);
  });

  it("fully refines an unrefined triangle whose three edges are all split", () => {
    // A big triangle made of four: the middle one (3, 4, 5) touches only refined neighbours.
    const coarse = {
      pos: new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0]),
      uv: new Float32Array(12),
      idx: new Uint32Array([0, 3, 5, 3, 1, 4, 5, 4, 2, 3, 4, 5]),
    };
    const { fine, out } = adaptiveFixture(coarse, (v) => v < 3);
    expect(out.length).toBe(16 * 3);
    expect([...out.slice(36)]).toEqual([...fine.idx.slice(36)]);
    expect(signedAreasZ(fine.pos, out).reduce((s, a) => s + a, 0)).toBeCloseTo(8, 9);
  });

  it("stitches every split pattern of a randomly refined grid without cracks", () => {
    for (const flip of [false, true]) {
      for (let trial = 0; trial < 6; trial++) {
        const grid = flatGrid(6, flip);
        const marked = new Set<number>();
        for (let v = 0; v < 49; v++) {
          if (Math.random() < 0.12) {
            marked.add(v);
          }
        }
        const { fine, out } = adaptiveFixture(grid, (v) => marked.has(v));
        expectCrackFree(fine, out, 6);
      }
    }
  });
});

describe("subdivision and adaptive index of the real leg model", () => {
  it("adds one vertex per coarse edge and four triangles per triangle", () => {
    const data = modelData();
    const coarse = legModel().collision;
    expect(coarse.pos.length / 3).toBe(data.stocking.positions.length / 3 + edgeCounts(data.stocking.indices).size);
    expect(coarse.idx.length).toBe(data.stocking.indices.length * 4);
    expect(coarse.uv.length / 2).toBe(coarse.pos.length / 3);
  });

  it("produces only in-range, non-degenerate triangles at every level", () => {
    const model = legModel();
    const vertexCount = model.stocking.attributes.position.count;
    expect(topologyProblems(model.collision.idx, model.collision.pos.length / 3)).toEqual([]);
    expect(topologyProblems(model.stocking.index!.array, vertexCount)).toEqual([]);
    expect(topologyProblems(model.skin.index!.array, model.skin.attributes.position.count)).toEqual([]);
  });

  it("has the same welded open boundary with and without adaptive detail (no cracks)", () => {
    const model = legModel();
    const weld = weldVertices(model.stocking.attributes.position.array);
    const adaptive = model.stocking.index!.array;
    const coarse = model.stockingLow.index!.array;
    expect(oddEdges(adaptive, weld)).toEqual(oddEdges(coarse, weld));
    expect([...edgeCounts(adaptive, weld).values()].every((n) => n <= 2)).toBe(true);
  });

  it("pins the adaptive index", () => {
    const index = legModel().stocking.index!.array as Uint32Array;
    expect([index.length / 3, digest(index)]).toMatchInlineSnapshot(`
      [
        85978,
        "c4209d43",
      ]
    `);
  });
});

describe("sliceAtHeights", () => {
  const attrs = (mesh: { pos: Float32Array; uv: Float32Array }) => ({
    position: { array: mesh.pos, itemSize: 3 },
    uv: { array: mesh.uv, itemSize: 2 },
  });
  const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

  it("leaves a mesh no plane crosses as it is", () => {
    const grid = flatGrid(2);
    // Planes on the rows of vertices and outside the mesh cut nothing.
    const sliced = sliceAtHeights(attrs(grid), grid.idx, [-1, 0, 1, 2, 3]);
    expect([...sliced.idx]).toEqual([...grid.idx]);
    expect([...sliced.attributes.position]).toEqual([...grid.pos]);
    expect([...sliced.attributes.uv]).toEqual([...grid.uv]);
  });

  it("cuts one triangle into a triangle and a quad, keeping its vertices, area and winding", () => {
    const pos = new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, 0]);
    const uv = new Float32Array([0, 0, 1, 0, 0, 1]);
    const sliced = sliceAtHeights(attrs({ pos, uv }), [0, 1, 2], [1]);
    expect([...sliced.attributes.position.slice(0, 9)]).toEqual([...pos]);
    // New vertices on the edges 0-2 and 1-2, at the plane, with the uv of that point of the edge.
    expect([...sliced.attributes.position.slice(9)]).toEqual([0, 1, 0, 3, 1, 0]);
    expect([...sliced.attributes.uv.slice(6)]).toEqual([0, 0.25, 0.75, 0.25]);
    expect(sliced.idx.length).toBe(9);
    const areas = signedAreasZ(sliced.attributes.position, sliced.idx);
    expect(areas.every((area) => area > 0)).toBe(true);
    expect(sum(areas)).toBeCloseTo(8, 12);
    expect(topologyProblems(sliced.idx, 5)).toEqual([]);
  });

  it("keeps the winding of triangles given the other way round", () => {
    const pos = new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, 0]);
    const uv = new Float32Array(6);
    for (const corners of [
      [0, 2, 1],
      [2, 1, 0],
      [1, 0, 2],
    ]) {
      const sliced = sliceAtHeights(attrs({ pos, uv }), corners, [0.5, 1, 3.5]);
      const areas = signedAreasZ(sliced.attributes.position, sliced.idx);
      expect(areas.every((area) => area < 0)).toBe(true);
      expect(sum(areas)).toBeCloseTo(-8, 6);
    }
  });

  it("adds two triangles per plane a triangle reaches across, however many there are", () => {
    // Bottom, middle and top corner at different heights: planes below, at and above the middle one.
    const pos = new Float32Array([0, 0, 0, 4, 2, 0, 1, 5, 0]);
    const uv = new Float32Array(6);
    const heights = [0.5, 1, 1.5, 2, 2.5, 3, 4, 4.75];
    const sliced = sliceAtHeights(attrs({ pos, uv }), [0, 1, 2], heights);
    // The plane through the middle corner cuts the long edge only.
    expect(sliced.attributes.position.length / 3).toBe(3 + heights.length * 2 - 1);
    expect(sliced.idx.length / 3).toBe(1 + heights.length * 2 - 1);
    const areas = signedAreasZ(sliced.attributes.position, sliced.idx);
    expect(areas.every((area) => area > 0)).toBe(true);
    expect(sum(areas)).toBeCloseTo(9, 5);
    // No piece reaches across a plane any more.
    const ys = (t: number) => [0, 1, 2].map((k) => sliced.attributes.position[sliced.idx[t * 3 + k] * 3 + 1]);
    for (let t = 0; t < sliced.idx.length / 3; t++) {
      const [low, high] = [Math.min(...ys(t)), Math.max(...ys(t))];
      expect(heights.filter((height) => height > low && height < high)).toEqual([]);
    }
  });

  it("handles flat bottom and flat top edges", () => {
    const uv = new Float32Array(6);
    for (const pos of [
      [0, 0, 0, 4, 0, 0, 2, 4, 0],
      [0, 4, 0, 2, 0, 0, 4, 4, 0],
    ]) {
      const sliced = sliceAtHeights(attrs({ pos: new Float32Array(pos), uv }), [0, 1, 2], [1, 2, 3]);
      expect(sliced.idx.length / 3).toBe(7);
      const areas = signedAreasZ(sliced.attributes.position, sliced.idx);
      expect(areas.every((area) => area > 0)).toBe(true);
      expect(sum(areas)).toBeCloseTo(8, 6);
    }
  });

  it("cuts a shared edge once, so a mesh stays closed", () => {
    for (const grid of [flatGrid(3), flatGrid(3, true)]) {
      const heights = [0.25, 0.5, 1.5, 2.2, 2.9];
      const sliced = sliceAtHeights(attrs(grid), grid.idx, heights);
      const count = sliced.attributes.position.length / 3;
      expect(topologyProblems(sliced.idx, count)).toEqual([]);
      // Every edge inside the grid still belongs to two triangles, and the outline is one closed loop of
      // boundary edges: those of the grid, plus two more per plane (one on each side).
      const counts = [...edgeCounts(sliced.idx).values()];
      expect(counts.every((n) => n <= 2)).toBe(true);
      expect(counts.filter((n) => n === 1)).toHaveLength(12 + heights.length * 2);
      // One new vertex per edge a plane crosses: 4 uprights and 3 diagonals per row of quads.
      expect(count).toBe(16 + heights.length * 7);
      const areas = signedAreasZ(sliced.attributes.position, sliced.idx);
      expect(areas.every((area) => area > 0)).toBe(true);
      expect(sum(areas)).toBeCloseTo(9, 5);
    }
  });

  it("gives the two sides of a seam the very same cut", () => {
    // Two triangles that meet along an edge whose vertices are doubled, given in opposite directions.
    const pos = new Float32Array([0, 0.1, 0, 1, 0.3, 0.2, 0.2, 0.9, 0.7, 0.2, 0.9, 0.7, 0, 0.1, 0, -1, 0.5, 0.1]);
    const uv = new Float32Array(12);
    const sliced = sliceAtHeights(attrs({ pos, uv }), [0, 1, 2, 3, 4, 5], [0.2, 0.37, 0.61, 0.8]);
    const points: string[] = [];
    for (let v = 6; v < sliced.attributes.position.length / 3; v++) {
      points.push(sliced.attributes.position.slice(v * 3, v * 3 + 3).join(" "));
    }
    // Each plane cuts the seam: its point appears once from either side, bit for bit.
    const doubled = points.filter((point, i) => points.indexOf(point) !== i);
    expect(doubled).toHaveLength(4);
    expect(new Set(doubled).size).toBe(4);
  });

  it("interpolates every attribute along the edge and keeps unit vectors unit length", () => {
    const pos = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
    const sliced = sliceAtHeights(
      {
        position: { array: pos, itemSize: 3 },
        normal: { array: new Float32Array([1, 0, 0, 1, 0, 0, 0, 0, 1]), itemSize: 3 },
        weight: { array: new Float32Array([0, 10, 4]), itemSize: 1 },
        pair: { array: new Float32Array([1, 0, 0, 0, 0, 1]), itemSize: 2 },
      },
      [0, 1, 2],
      [1],
      ["normal"],
    );
    expect(Object.keys(sliced.attributes)).toEqual(["position", "normal", "weight", "pair"]);
    // The cut on the edge 0-2, halfway up, then the one on 1-2.
    expect([...sliced.attributes.weight.slice(3)]).toEqual([2, 7]);
    expect([...sliced.attributes.pair.slice(6)]).toEqual([0.5, 0.5, 0, 0.5]);
    const normal = [...sliced.attributes.normal.slice(9)];
    expect(normal[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(normal[2]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.hypot(...normal.slice(3))).toBeCloseTo(1, 6);
  });

  it("rings a tube: one loop of new vertices per plane and seam-free strips between them", () => {
    const mesh = tube(1, 0, 3, 4, 12);
    const heights = [0.5, 0.75, 1.25, 2.5];
    const sliced = sliceAtHeights(attrs(mesh), mesh.idx, heights);
    const position = sliced.attributes.position;
    // Each plane crosses 12 uprights and 12 diagonals.
    expect(position.length / 3).toBe(48 + heights.length * 24);
    expect(sliced.idx.length / 3).toBe(72 + heights.length * 48);
    const ringed = new Map<number, number>();
    for (let v = 48; v < position.length / 3; v++) {
      ringed.set(position[v * 3 + 1], (ringed.get(position[v * 3 + 1]) ?? 0) + 1);
    }
    expect([...ringed]).toEqual(heights.map((height) => [height, 24]));
    // Still a tube: closed around, open at its two ends only.
    expect(oddEdges(sliced.idx)).toEqual(oddEdges(mesh.idx));
    expect([...edgeCounts(sliced.idx).values()].every((n) => n <= 2)).toBe(true);
    expect(topologyProblems(sliced.idx, position.length / 3)).toEqual([]);
  });
});
