import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { weldVertices } from "../../../src/engine/geometry/weld";
import { bonyAt } from "../../../src/engine/model/anatomy";
import {
  buildForefoot,
  buildForefootCollision,
  FOREFOOT_JOIN,
  frontOfJoin,
  UNDER_FIT,
} from "../../../src/engine/model/forefoot";
import type { ForefootCollision, ForefootData } from "../../../src/engine/model/forefoot";
import { parseModelGlb } from "../../../src/engine/model/glb";
import { buildLegModel } from "../../../src/engine/model/legModel";
import { stretchAt } from "../../../src/engine/model/tangents";
import { SurfaceGrid } from "../../../src/engine/surface/SurfaceGrid";
import type { SurfaceMesh } from "../../../src/engine/surface/SurfaceGrid";
import { legModel, modelData } from "../../helpers/model";
import { edgeCounts, edgeVertices, tinyGlb, tinyModelData, topologyProblems } from "./fixtures";

const FOREFOOT_ATTRIBUTES = ["legTangent", "normal", "position", "skinFx", "stretch", "toeShade", "under", "uv"];

function forefoot(): THREE.BufferGeometry {
  const geometry = legModel().forefoot;
  if (!geometry) {
    throw new Error("the shipped model has no forefoot");
  }
  return geometry;
}

/** A geometry's triangles as a surface to query. */
function surfaceOf(geometry: THREE.BufferGeometry): SurfaceGrid {
  return new SurfaceGrid({
    pos: geometry.attributes.position.array,
    nrm: geometry.attributes.normal.array,
    uv: geometry.attributes.uv.array,
    idx: geometry.index!.array,
  });
}

function extent(array: ArrayLike<number>): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < array.length; i++) {
    min = Math.min(min, array[i]);
    max = Math.max(max, array[i]);
  }
  return [min, max];
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function skinCollision(): ForefootCollision {
  const collision = legModel().forefootCollision;
  if (!collision) {
    throw new Error("the shipped model has no forefoot");
  }
  return collision;
}

/** Per triangle: how far apart its corners are in u or v (the larger), with `vertexOf` naming each corner's uv. */
function uvSpans(
  uvs: ArrayLike<number>,
  indices: ArrayLike<number>,
  vertexOf: (v: number) => number = (v) => v,
): number[] {
  const spans: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]].map(vertexOf);
    const us = corners.map((v) => uvs[v * 2]);
    const vs = corners.map((v) => uvs[v * 2 + 1]);
    spans.push(Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)));
  }
  return spans;
}

/**
 * The connected pieces of the triangles whose three vertices all pass `keep`: vertex -> piece, for the vertices
 * of those triangles. Vertices at the same position count as one.
 */
function pieces(geometry: THREE.BufferGeometry, keep: (v: number) => boolean): Map<number, number> {
  const weld = weldVertices(geometry.attributes.position.array);
  const indices = geometry.index!.array;
  const parent = Int32Array.from(weld, (_, i) => i);
  const find = (v: number): number => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]];
      v = parent[v];
    }
    return v;
  };
  const kept: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]];
    if (corners.every(keep)) {
      kept.push(...corners);
      parent[find(weld[corners[1]])] = find(weld[corners[0]]);
      parent[find(weld[corners[2]])] = find(weld[corners[0]]);
    }
  }
  return new Map(kept.map((v) => [v, find(weld[v])]));
}

describe("parseModelGlb forefoot", () => {
  it("reads the forefoot's control cage with one shade per vertex", () => {
    const data = modelData().forefoot!;
    expect(data.positions).toBeInstanceOf(Float32Array);
    expect(data.shade).toBeInstanceOf(Uint8Array);
    expect(data.positions.length % 3).toBe(0);
    expect(data.positions.length).toBeGreaterThan(0);
    expect(data.shade.length).toBe(data.positions.length / 3);
    const [minShade, maxShade] = extent(data.shade);
    expect(minShade).toBeGreaterThanOrEqual(0);
    expect(maxShade).toBeLessThanOrEqual(255);
    // Most of the skin is not between two toes, some of it is.
    expect(minShade).toBe(0);
    expect(maxShade).toBeGreaterThan(128);
    expect(Array.from(data.shade).filter((v) => v === 0).length).toBeGreaterThan(data.shade.length / 2);
  });

  it("stores the cage's quads as triangle pairs a b c, a c d over four different vertices", () => {
    const data = modelData().forefoot!;
    const { indices } = data;
    expect(indices.length % 6).toBe(0);
    expect(indices.length).toBeGreaterThan(0);
    const vertexCount = data.positions.length / 3;
    for (let q = 0; q < indices.length; q += 6) {
      const quad = [indices[q], indices[q + 1], indices[q + 2], indices[q + 5]];
      if (indices[q] !== indices[q + 3] || indices[q + 2] !== indices[q + 4] || new Set(quad).size !== 4) {
        throw new Error("not a quad at " + q / 6);
      }
      if (quad.some((v) => v >= vertexCount)) {
        throw new Error("out of range at " + q / 6);
      }
    }
    expect(new Set(Array.from(indices)).size).toBe(vertexCount);
  });

  it("reads five toenail frames, the big toe first", () => {
    const nails = modelData().forefoot!.nails!;
    expect(nails.length).toBe(5);
    for (const nail of nails) {
      expect([nail.center.length, nail.normal.length, nail.forward.length, nail.half.length]).toEqual([3, 3, 3, 2]);
      expect(Math.hypot(...nail.normal)).toBeCloseTo(1, 4);
      expect(Math.hypot(...nail.forward)).toBeCloseTo(1, 4);
      expect(dot(nail.normal, nail.forward)).toBeCloseTo(0, 4);
      // On top of the toe, pointing forward, a few millimeters across.
      expect(nail.normal[1]).toBeGreaterThan(0.5);
      expect(nail.forward[2]).toBeGreaterThan(0.5);
      expect(Math.min(...nail.half)).toBeGreaterThan(0.001);
      expect(Math.max(...nail.half)).toBeLessThan(0.012);
    }
    const widths = nails.map((nail) => nail.half[0]);
    expect(Math.max(...widths.slice(1))).toBeLessThan(widths[0]);
    // The toes lie side by side, from the big toe outward.
    const steps = nails.slice(1).map((nail, i) => Math.sign(nail.center[0] - nails[i].center[0]));
    expect(new Set(steps).size).toBe(1);
    expect(steps[0]).not.toBe(0);
    expect(legModel().nails).toEqual(nails);
  });

  it("returns a null forefoot for a model file without that mesh", () => {
    expect(parseModelGlb(tinyGlb()).forefoot).toBeNull();
  });
});

const TILT = [0.6, 0.8, 0];

/** A flat piece of stocking in the plane y = height with the given normal, u along x and v along z. */
function flatStocking(height: number, normal: number[]): SurfaceMesh {
  return {
    pos: [-0.05, height, 0.05, 0.05, height, 0.05, 0.05, height, 0.25, -0.05, height, 0.25],
    nrm: [...normal, ...normal, ...normal, ...normal],
    uv: [0, 0, 1, 0, 1, 1, 0, 1],
    idx: [0, 2, 1, 0, 3, 2],
  };
}

/**
 * A flat cage of 2 x 6 quads of 1 cm at height y, from z = 0.09 (behind the cut) to z = 0.15, facing up.
 * Its front row of vertices is fully shaded.
 */
function flatCage(y: number): ForefootData {
  const positions: number[] = [];
  const shade: number[] = [];
  const indices: number[] = [];
  for (let k = 0; k <= 6; k++) {
    for (let i = 0; i <= 2; i++) {
      positions.push((i - 1) * 0.01, y, 0.09 + k * 0.01);
      shade.push(k === 6 ? 255 : 0);
    }
  }
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < 2; i++) {
      const [a, b, c, d] = [k * 3 + i, (k + 1) * 3 + i, (k + 1) * 3 + i + 1, k * 3 + i + 1];
      indices.push(a, b, c, a, c, d);
    }
  }
  return { positions: new Float32Array(positions), shade: new Uint8Array(shade), indices: new Uint16Array(indices) };
}

/**
 * A flat piece of stocking like flatStocking(), cut along x = 0 into two UV islands: u runs 5 per meter on both
 * sides, from 0 on the left one and from 0.6 at the cut on the right one.
 */
function seamedStocking(height: number): SurfaceMesh {
  const half = (x0: number, u0: number): { pos: number[]; uv: number[] } => ({
    pos: [x0, height, 0.05, x0 + 0.05, height, 0.05, x0 + 0.05, height, 0.25, x0, height, 0.25],
    uv: [u0, 0, u0 + 0.25, 0, u0 + 0.25, 1, u0, 1],
  });
  const left = half(-0.05, 0);
  const right = half(0, 0.6);
  return {
    pos: [...left.pos, ...right.pos],
    nrm: Array.from({ length: 8 }, () => [0, 1, 0]).flat(),
    uv: [...left.uv, ...right.uv],
    idx: [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6],
  };
}

/** The u of a point on seamedStocking() by the left island's UVs, and by the right one's. */
const seamedU = (x: number): [number, number] => [(x + 0.05) * 5, 0.6 + x * 5];

describe("buildForefoot on a flat cage", () => {
  // The render mesh lies in the plane y = 0 and is lit at a tilt; the collision mesh lies 2 mm under it.
  const build = (y: number): THREE.BufferGeometry =>
    buildForefoot(flatCage(y), flatStocking(0, TILT), flatStocking(-0.002, [0, 1, 0]), [0.34 * 1.5]);

  it("subdivides the cage twice", () => {
    const geometry = build(0.005);
    // 21 vertices, 32 edges and 12 quads become 65 vertices, 112 edges and 48 quads, then 225 vertices.
    expect(geometry.attributes.position.count).toBe(225);
    expect(Object.keys(geometry.attributes).sort()).toEqual(FOREFOOT_ATTRIBUTES);
    expect(topologyProblems(geometry.index!.array, 225)).toEqual([]);
    const [minX, maxX] = extent(geometry.attributes.position.array.filter((_, i) => i % 3 === 0));
    const [minZ, maxZ] = extent(geometry.attributes.position.array.filter((_, i) => i % 3 === 2));
    expect([minX, maxX, minZ, maxZ]).toEqual([-0.01, 0.01, 0.09, 0.15].map(Math.fround));
  });

  it("lays the cage onto the stocking's render mesh behind the cut and blends into its own shape", () => {
    const positions = build(0.005).attributes.position.array;
    const seen = { on: 0, between: 0, own: 0 };
    const blend: [number, number][] = [];
    for (let i = 0; i < positions.length; i += 3) {
      const [y, z] = [positions[i + 1], positions[i + 2]];
      blend.push([z, y]);
      if (z <= FOREFOOT_JOIN.cut) {
        expect(y).toBe(0);
        seen.on++;
      } else if (z >= FOREFOOT_JOIN.to) {
        expect(y).toBe(Math.fround(0.005));
        seen.own++;
      } else {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(Math.fround(0.005));
        seen.between++;
      }
    }
    expect(Object.values(seen).every((count) => count >= 27)).toBe(true);
    // One smooth rise from the stocking to the cage's height.
    blend.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < blend.length; i++) {
      expect(blend[i][1] - blend[i - 1][1]).toBeGreaterThan(-1e-9);
      expect(blend[i][1] - blend[i - 1][1]).toBeLessThan(0.002);
    }
    const middle = (FOREFOOT_JOIN.cut + FOREFOOT_JOIN.to) / 2;
    const halfway = blend.filter(([z]) => Math.abs(z - middle) < 0.002).map(([, y]) => y);
    expect(Math.min(...halfway)).toBeGreaterThan(0.001);
    expect(Math.max(...halfway)).toBeLessThan(0.004);
  });

  it("is lit like the stocking behind the cut and by its own shape in front of the join", () => {
    // A cage that lies in the stocking's plane, so its own normals point straight up.
    const geometry = build(0);
    const positions = geometry.attributes.position.array;
    const normals = geometry.attributes.normal.array;
    const tangents = geometry.attributes.legTangent.array;
    const seen = { on: 0, between: 0, own: 0 };
    const tilt: [number, number][] = [];
    for (const v of new Set(geometry.index!.array)) {
      const z = positions[v * 3 + 2];
      const normal = [...normals.subarray(v * 3, v * 3 + 3)];
      expect(Math.hypot(...normal)).toBeCloseTo(1, 6);
      expect(dot(normal, [...tangents.subarray(v * 3, v * 3 + 3)])).toBeCloseTo(0, 6);
      tilt.push([z, normal[0]]);
      if (z <= FOREFOOT_JOIN.cut) {
        expect(normal).toEqual(TILT.map(Math.fround));
        seen.on++;
      } else if (z >= FOREFOOT_JOIN.to) {
        expect(normal).toEqual([0, 1, 0]);
        seen.own++;
      } else {
        // Somewhere between the stocking's normal and its own.
        expect(normal[2]).toBe(0);
        expect(normal[1]).toBeGreaterThanOrEqual(Math.fround(TILT[1]));
        seen.between++;
      }
    }
    expect(Object.values(seen).every((count) => count >= 9)).toBe(true);
    tilt.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < tilt.length; i++) {
      expect(tilt[i][1] - tilt[i - 1][1]).toBeLessThan(1e-6);
    }
    // Vertices behind the cut that no triangle uses get the stocking's normal too.
    expect([...normals.subarray(0, 3)]).toEqual(TILT.map(Math.fround));
  });

  it("reaches a little behind the cut and drops the quads further back", () => {
    const geometry = build(0.005);
    const positions = geometry.attributes.position.array;
    const indices = geometry.index!.array;
    const { cut } = FOREFOOT_JOIN;
    expect(indices.length % 6).toBe(0);
    for (let q = 0; q < indices.length; q += 6) {
      const quad = [indices[q], indices[q + 1], indices[q + 2], indices[q + 5]];
      expect([indices[q + 3], indices[q + 4]]).toEqual([quad[0], quad[2]]);
      expect(quad.some((v) => positions[v * 3 + 2] > cut - 0.01)).toBe(true);
    }
    // Rows of 8 quads of 2.5 mm, 24 of them: whole rows stay or go.
    expect((indices.length / 6) % 8).toBe(0);
    expect(indices.length / 6).toBeLessThan(8 * 24);
    const used = new Set(indices);
    let minZ = Infinity;
    for (let v = 0; v < 225; v++) {
      const z = positions[v * 3 + 2];
      if (used.has(v)) {
        minZ = Math.min(minZ, z);
      } else {
        expect(z).toBeLessThan(cut);
      }
    }
    // Clipped at the cut, the skin leaves no gap: it starts at least a row behind it.
    expect(minZ).toBeLessThan(cut - 0.002);
    expect(minZ).toBeGreaterThan(cut - 0.01);
    for (let v = 0; v < 225; v++) {
      expect(used.has(v)).toBe(positions[v * 3 + 2] > minZ - 0.0001);
    }
  });

  it("takes the uv from the collision mesh under each vertex", () => {
    const geometry = build(0.005);
    const positions = geometry.attributes.position.array;
    const uvs = geometry.attributes.uv.array;
    for (let i = 0; i < 225; i++) {
      expect(uvs[i * 2]).toBeCloseTo((positions[i * 3] + 0.05) / 0.1, 5);
      expect(uvs[i * 2 + 1]).toBeCloseTo((positions[i * 3 + 2] - 0.05) / 0.2, 5);
    }
  });

  it("adds no vertices where the stocking's UVs have no seam", () => {
    for (const y of [0, 0.005, 0.05]) {
      const geometry = build(y);
      expect(geometry.attributes.position.count).toBe(225);
      expect(new Set(weldVertices(geometry.attributes.position.array)).size).toBe(225);
    }
  });

  it("gives the triangles across a seam of the stocking's UVs corners of their own, on one side of it", () => {
    const geometry = buildForefoot(flatCage(0.005), flatStocking(0, TILT), seamedStocking(-0.002), [0.34 * 1.5]);
    const positions = geometry.attributes.position.array;
    const uvs = geometry.attributes.uv.array;
    const indices = geometry.index!.array;
    const count = geometry.attributes.position.count;
    expect(count).toBeGreaterThan(225);
    for (const name of FOREFOOT_ATTRIBUTES) {
      expect(geometry.attributes[name].count).toBe(count);
    }
    expect(topologyProblems(indices, count)).toEqual([]);
    // Every triangle reads its three UVs off one island, the vertices on the seam and past it included.
    const sides = [0, 0];
    const crossing = [0, 0];
    for (let t = 0; t < indices.length; t += 3) {
      const corners = [indices[t], indices[t + 1], indices[t + 2]];
      const side = [0, 1].filter((k) =>
        corners.every((v) => Math.abs(uvs[v * 2] - seamedU(positions[v * 3])[k]) < 1e-5),
      );
      if (side.length !== 1) {
        throw new Error("triangle " + t / 3 + " has the u " + corners.map((v) => uvs[v * 2]));
      }
      sides[side[0]]++;
      for (const v of corners) {
        expect(uvs[v * 2 + 1]).toBeCloseTo((positions[v * 3 + 2] - 0.05) / 0.2, 5);
      }
      // A triangle next to the seam may continue its island's UVs past it.
      const xs = corners.map((v) => positions[v * 3]);
      if (side[0] === 0 ? Math.max(...xs) > 1e-6 : Math.min(...xs) < -1e-6) {
        crossing[side[0]]++;
        expect(Math.max(...xs.map(Math.abs))).toBeLessThan(0.0026);
      }
    }
    expect(Math.min(...sides)).toBeGreaterThan(indices.length / 3 / 4);
    expect(crossing[0] + crossing[1]).toBeLessThanOrEqual(2 * 24);
    // The new vertices copy vertices of the 9 x 25 grid: same place, shade and lighting, another uv.
    const weld = weldVertices(positions);
    const used = new Set(indices);
    for (let v = 225; v < count; v++) {
      const source = weld[v];
      expect(source).toBeLessThan(225);
      expect(used.has(v)).toBe(true);
      expect(Math.abs(positions[v * 3])).toBeLessThan(0.0026);
      expect(Math.abs(uvs[v * 2] - uvs[source * 2])).toBeGreaterThan(0.3);
      for (const name of FOREFOOT_ATTRIBUTES.filter((attribute) => attribute !== "uv")) {
        const { array, itemSize } = geometry.attributes[name];
        expect([...array.subarray(v * itemSize, (v + 1) * itemSize)]).toEqual([
          ...array.subarray(source * itemSize, (source + 1) * itemSize),
        ]);
      }
    }
    // One copy per vertex and island at most.
    expect(count - 225).toBeLessThanOrEqual(3 * 25);
    const seen = new Set<string>();
    for (let v = 0; v < count; v++) {
      const key = weld[v] + ":" + Math.round(uvs[v * 2] * 1e5);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("keeps the cage's shape and marks the uv as missing where no stocking is within reach", () => {
    const geometry = build(0.05);
    const positions = geometry.attributes.position.array;
    expect(new Set(geometry.attributes.uv.array)).toEqual(new Set([-1]));
    expect(new Set(positions.filter((_, i) => i % 3 === 1))).toEqual(new Set([Math.fround(0.05)]));
    // Sideways it is where the cage near the stocking is, which only moves straight down onto it.
    const near = build(0.005).attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i]).toBeCloseTo(near[i], 9);
      expect(positions[i + 2]).toBeCloseTo(near[i + 2], 9);
    }
    expect(geometry.index!.count).toBe(build(0.005).index!.count);
    const normals = geometry.attributes.normal.array;
    for (const v of new Set(geometry.index!.array)) {
      expect([...normals.subarray(v * 3, v * 3 + 3)]).toEqual([0, 1, 0]);
    }
  });

  it("subdivides the shade along with the positions, from 0..255 to 0..1", () => {
    const geometry = build(0.005);
    const positions = geometry.attributes.position.array;
    const shade = geometry.attributes.toeShade.array;
    expect(extent(shade)).toEqual([0, 1]);
    for (let i = 0; i < 225; i++) {
      const z = positions[i * 3 + 2];
      if (z < 0.1349) {
        expect(shade[i]).toBe(0);
      } else if (z > 0.1401) {
        expect(shade[i]).toBeGreaterThan(0);
      }
    }
    // The middle of the front border, which only has shaded neighbors on the border; its ends round off.
    const front = [...Array(225).keys()].filter((i) => positions[i * 3 + 2] === Math.fround(0.15));
    expect(front.map((i) => shade[i])).toEqual([1, 1, 1]);
  });

  it("fills in stretch from the circumference and the bony factor, with no bump depth", () => {
    const geometry = build(0.005);
    const positions = geometry.attributes.position.array;
    const normals = geometry.attributes.normal.array;
    const skinFx = geometry.attributes.skinFx.array;
    expect(new Set(geometry.attributes.stretch.array)).toEqual(new Set([1.5]));
    for (let i = 0; i < 225; i++) {
      const [x, y, z] = positions.subarray(i * 3, i * 3 + 3);
      const [nx, ny, nz] = normals.subarray(i * 3, i * 3 + 3);
      expect(skinFx[i * 2]).toBe(0);
      expect(skinFx[i * 2 + 1]).toBe(Math.fround(bonyAt(x, y, z, nx, ny, nz)));
    }
    // The front of the cage reaches the bony region over the toes.
    expect(extent(skinFx)[1]).toBeGreaterThan(0.01);
  });
});

describe("buildForefoot on the shipped model", () => {
  it("fits the skin to the stocking it lies under, a hair inside the fabric and never through it", () => {
    const geometry = forefoot();
    const model = legModel();
    const fabric = surfaceOf(model.stocking);
    const positions = geometry.attributes.position.array;
    const normals = geometry.attributes.normal.array;
    const under = geometry.attributes.under.array;
    const weld = weldVertices(positions);
    let pressed = 0;
    let worn = 0;
    let longest = 0;
    let nearest = Infinity;
    for (let i = 0; i < positions.length / 3; i++) {
      const [dx, dy, dz, cover] = under.subarray(i * 4, i * 4 + 4);
      // Copies of a vertex at a UV seam move together.
      expect(Array.from(under.subarray(weld[i] * 4, weld[i] * 4 + 4))).toEqual([dx, dy, dz, cover]);
      expect(cover).toBeGreaterThanOrEqual(0);
      expect(cover).toBeLessThanOrEqual(1);
      longest = Math.max(longest, Math.hypot(dx, dy, dz));
      worn += cover > 0.5 ? 1 : 0;
      // Under a stocking the skin is drawn from 3 mm behind the join on (uClip -0.1).
      if (positions[i * 3 + 2] < FOREFOOT_JOIN.cut - 0.004) {
        continue;
      }
      const hit = fabric.closest(positions[i * 3] + dx, positions[i * 3 + 1] + dy, positions[i * 3 + 2] + dz, 0.0005);
      if (
        !hit ||
        normals[i * 3] * hit.nx + normals[i * 3 + 1] * hit.ny + normals[i * 3 + 2] * hit.nz < UNDER_FIT.facing[0]
      ) {
        // Not under this fabric: the wall of a toe beside fabric that bridges the cleft.
        expect(cover).toBe(0);
        continue;
      }
      // Under the fabric (on the far side of its normal), at least the margin away.
      expect(hit.side).toBe(-1);
      nearest = Math.min(nearest, hit.dist);
      pressed += hit.dist < UNDER_FIT.margin * 1.5 ? 1 : 0;
    }
    expect(nearest).toBeGreaterThan(UNDER_FIT.margin * 0.97);
    // Behind the toes the skin is pressed against the fabric (the toes keep their shape, and the fabric is
    // fitted to them instead), and it never has to move further than the fit allows.
    expect(pressed).toBeGreaterThan(positions.length / 3 / 5);
    expect(worn).toBeGreaterThan(2000);
    expect(longest).toBeLessThan(UNDER_FIT.loose);
  });

  it("builds a geometry with the attributes the leg shader reads, one value per vertex", () => {
    const geometry = forefoot();
    expect(Object.keys(geometry.attributes).sort()).toEqual(FOREFOOT_ATTRIBUTES);
    expect(Object.keys(legModel().stocking.attributes).sort()).toEqual(FOREFOOT_ATTRIBUTES);
    const count = geometry.attributes.position.count;
    expect(count).toBeGreaterThan(modelData().forefoot!.positions.length / 3);
    const sizes: Record<string, number> = {};
    for (const name of FOREFOOT_ATTRIBUTES) {
      expect(geometry.attributes[name].count).toBe(count);
      expect(geometry.attributes[name].array).toBeInstanceOf(Float32Array);
      sizes[name] = geometry.attributes[name].itemSize;
    }
    expect(sizes).toEqual({
      legTangent: 3,
      normal: 3,
      position: 3,
      skinFx: 2,
      stretch: 1,
      toeShade: 1,
      under: 4,
      uv: 2,
    });
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingSphere).not.toBeNull();
  });

  it("indexes only existing vertices, in whole triangles", () => {
    const geometry = forefoot();
    const indices = geometry.index!.array;
    expect(indices.length % 6).toBe(0);
    expect(indices.length).toBeGreaterThan(0);
    expect(topologyProblems(indices, geometry.attributes.position.count)).toEqual([]);
  });

  it("gives every drawn vertex a unit normal and a unit tangent perpendicular to it", () => {
    const geometry = forefoot();
    const normals = geometry.attributes.normal.array;
    const tangents = geometry.attributes.legTangent.array;
    for (const v of new Set(geometry.index!.array)) {
      const normal = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
      const tangent = [tangents[v * 3], tangents[v * 3 + 1], tangents[v * 3 + 2]];
      if (Math.abs(Math.hypot(...normal) - 1) > 1e-4 || Math.abs(Math.hypot(...tangent) - 1) > 1e-4) {
        throw new Error("non-unit vector at " + v);
      }
      if (Math.abs(dot(normal, tangent)) > 1e-4) {
        throw new Error("tangent not perpendicular to the normal at " + v);
      }
    }
  });

  it("keeps the toe shade within [0, 1], dark between the toes and clear where the foot joins the stocking", () => {
    const shade = forefoot().attributes.toeShade.array;
    const [minShade, maxShade] = extent(shade);
    expect(minShade).toBe(0);
    expect(maxShade).toBeLessThanOrEqual(1);
    expect(maxShade).toBeGreaterThan(0.5);
    expect(Array.from(shade).filter((v) => v === 0).length).toBeGreaterThan(shade.length / 8);
    const positions = forefoot().attributes.position.array;
    for (let i = 0; i < shade.length; i++) {
      if (shade[i] > 0.1 && positions[i * 3 + 2] < FOREFOOT_JOIN.to) {
        throw new Error("shade behind the toes at " + i);
      }
    }
  });

  it("lies on the stocking's render mesh behind the cut, lit like it", () => {
    const model = legModel();
    const geometry = forefoot();
    const positions = geometry.attributes.position.array;
    const normals = geometry.attributes.normal.array;
    const stocking = surfaceOf(model.stocking);
    let behind = 0;
    for (const v of new Set(geometry.index!.array)) {
      const [x, y, z] = positions.subarray(v * 3, v * 3 + 3);
      if (z < FOREFOOT_JOIN.cut) {
        behind++;
        const hit = stocking.closest(x, y, z, 0.01);
        if (!hit || hit.dist > 0.00005) {
          throw new Error("vertex " + v + " is off the stocking: " + hit?.dist);
        }
        if (dot([hit.nx, hit.ny, hit.nz], [...normals.subarray(v * 3, v * 3 + 3)]) < 0.999) {
          throw new Error("the normal of vertex " + v + " is not the stocking's");
        }
      }
    }
    expect(behind).toBeGreaterThan(20);
  });

  it("meets the stocking in one line where the two are clipped at the cut", () => {
    const geometry = forefoot();
    const positions = geometry.attributes.position.array;
    const normals = geometry.attributes.normal.array;
    const stocking = surfaceOf(legModel().stocking);
    const { cut } = FOREFOOT_JOIN;
    let crossings = 0;
    for (const edge of edgeCounts(geometry.index!.array).keys()) {
      const [a, b] = edgeVertices(edge);
      const za = positions[a * 3 + 2];
      const zb = positions[b * 3 + 2];
      if (za < cut === zb < cut) {
        continue;
      }
      crossings++;
      const t = (cut - za) / (zb - za);
      const at = (array: ArrayLike<number>): number[] =>
        [0, 1, 2].map((k) => array[a * 3 + k] + (array[b * 3 + k] - array[a * 3 + k]) * t);
      const point = at(positions);
      const normal = at(normals);
      const hit = stocking.closest(point[0], point[1], point[2], 0.01);
      if (!hit || hit.dist > 0.0003) {
        throw new Error("a step of " + hit?.dist + " m at the cut near vertex " + a);
      }
      if (dot([hit.nx, hit.ny, hit.nz], normal) / Math.hypot(...normal) < 0.995) {
        throw new Error("the lighting changes at the cut near vertex " + a);
      }
    }
    expect(crossings).toBeGreaterThan(50);
  });

  it("starts behind the cut all the way around the foot", () => {
    const geometry = forefoot();
    const positions = geometry.attributes.position.array;
    const weld = weldVertices(positions);
    const neighbors = new Map<number, number[]>();
    for (const [edge, uses] of edgeCounts(geometry.index!.array, weld)) {
      expect(uses).toBeLessThanOrEqual(2);
      if (uses === 1) {
        const [a, b] = edgeVertices(edge);
        neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
        neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
      }
    }
    // The toes are closed: the only open border is one ring at the back.
    const border = [...neighbors.keys()];
    expect(border.length).toBeGreaterThan(20);
    expect(border.filter((v) => neighbors.get(v)!.length !== 2)).toEqual([]);
    const ring = new Set([border[0]]);
    for (let v = neighbors.get(border[0])![0]; !ring.has(v);) {
      ring.add(v);
      v = neighbors.get(v)!.find((next) => !ring.has(next)) ?? v;
    }
    expect(ring.size).toBe(border.length);
    // A bare leg clips the stocking and the skin at the cut: a border behind it leaves no hole.
    const inFront = border.filter((v) => positions[v * 3 + 2] >= FOREFOOT_JOIN.cut);
    expect(inFront.map((v) => [...positions.subarray(v * 3, v * 3 + 3)].map((c) => Math.round(c * 1e4) / 1e4))).toEqual(
      [],
    );
  });

  it("reaches a little behind the cut and leaves the stocking's shape in front of the join", () => {
    const model = legModel();
    const geometry = forefoot();
    const positions = geometry.attributes.position.array;
    const surface = new SurfaceGrid(model.collision);
    let minZ = Infinity;
    let furthest = 0;
    for (const v of new Set(geometry.index!.array)) {
      const z = positions[v * 3 + 2];
      minZ = Math.min(minZ, z);
      if (z > FOREFOOT_JOIN.to) {
        furthest = Math.max(furthest, surface.closest(positions[v * 3], positions[v * 3 + 1], z, 0.005)?.dist ?? 0.005);
      }
    }
    expect(minZ).toBeLessThan(FOREFOOT_JOIN.cut);
    // The quads further back are dropped, so nothing reaches far behind the cut.
    expect(minZ).toBeGreaterThan(FOREFOOT_JOIN.cut - 0.02);
    // Between the toes the skin is millimeters under the stocking stretched across them.
    expect(furthest).toBeGreaterThan(0.002);
    expect(geometry.boundingBox!.max.y).toBeLessThan(FOREFOOT_JOIN.maxY);
    expect(geometry.boundingBox!.max.z).toBeGreaterThan(0.18);
  });

  it("borrows the stocking's wet-map uvs", () => {
    const model = legModel();
    const geometry = forefoot();
    const [minUv, maxUv] = extent(geometry.attributes.uv.array);
    expect(minUv).toBeGreaterThanOrEqual(0);
    expect(maxUv).toBeLessThanOrEqual(1);
    // Behind the cut the drawn skin is the stocking's surface, so the uv is the one found there (the copies of
    // vertices at a seam of the UVs aside: those continue the UVs of the seam's other side).
    const positions = geometry.attributes.position.array;
    const uvs = geometry.attributes.uv.array;
    const surface = new SurfaceGrid(model.collision);
    const weld = weldVertices(positions);
    let checked = 0;
    for (const v of new Set(geometry.index!.array)) {
      if (positions[v * 3 + 2] < FOREFOOT_JOIN.cut && weld[v] === v) {
        const hit = surface.closest(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], 0.01)!;
        if (Math.hypot(hit.u - uvs[v * 2], hit.v - uvs[v * 2 + 1]) > 0.002) {
          throw new Error("uv of vertex " + v + " is not the stocking's");
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("keeps every triangle's UVs together, across the seams of the stocking's UVs too", () => {
    const geometry = forefoot();
    const uvs = geometry.attributes.uv.array;
    const indices = geometry.index!.array;
    // Triangles are a few millimeters across, which is under 0.02 in the stocking's UVs.
    const spans = uvSpans(uvs, indices);
    expect(Math.max(...spans)).toBeLessThan(0.03);
    // With every vertex reading the stocking's nearest point (as the first vertex at each place does), the
    // triangles over a seam, or deep between two toes, would reach a third of the way across the UVs.
    const weld = weldVertices(geometry.attributes.position.array);
    const nearest = uvSpans(uvs, indices, (v) => weld[v]);
    const apart = nearest.filter((span) => span > 0.03).length;
    expect(apart).toBeGreaterThan(500);
    expect(apart).toBeLessThan(indices.length / 3 / 10);
    expect(Math.max(...nearest)).toBeGreaterThan(0.3);
  });

  it("copies the vertices at the seams with everything but the uv, so the skin is lit across them", () => {
    const geometry = forefoot();
    const positions = geometry.attributes.position.array;
    const uvs = geometry.attributes.uv.array;
    const weld = weldVertices(positions);
    const used = new Set(geometry.index!.array);
    let copies = 0;
    let across = 0;
    for (let v = 0; v < weld.length; v++) {
      const source = weld[v];
      // Behind the drawn part the skin is laid onto the stocking, where two vertices may land in one place.
      if (source === v || !used.has(v)) {
        continue;
      }
      for (const name of FOREFOOT_ATTRIBUTES.filter((attribute) => attribute !== "uv")) {
        const { array, itemSize } = geometry.attributes[name];
        for (let k = 0; k < itemSize; k++) {
          if (array[v * itemSize + k] !== array[source * itemSize + k]) {
            throw new Error(name + " of vertex " + v + " is not that of vertex " + source);
          }
        }
      }
      // In front of the join nothing else puts two vertices in one place.
      if (positions[v * 3 + 2] > FOREFOOT_JOIN.to) {
        copies++;
        if (!used.has(v) || (uvs[v * 2] === uvs[source * 2] && uvs[v * 2 + 1] === uvs[source * 2 + 1])) {
          throw new Error("vertex " + v + " copies vertex " + source + " for nothing");
        }
        if (Math.max(Math.abs(uvs[v * 2] - uvs[source * 2]), Math.abs(uvs[v * 2 + 1] - uvs[source * 2 + 1])) > 0.005) {
          across++;
        }
      }
    }
    expect(copies).toBeGreaterThan(300);
    expect(copies).toBeLessThan(weld.length / 10);
    // The copies are for the far side of a seam: a corner on the near side keeps its vertex, and its uv.
    expect(across).toBeGreaterThan(copies * 0.95);
  });

  it("takes the stretch from the leg's circumference and the flush from the bony regions", () => {
    const model = legModel();
    const geometry = forefoot();
    const positions = geometry.attributes.position.array;
    const normals = geometry.attributes.normal.array;
    const stretch = geometry.attributes.stretch.array;
    const skinFx = geometry.attributes.skinFx.array;
    for (let i = 0; i < stretch.length; i++) {
      const [x, y, z] = positions.subarray(i * 3, i * 3 + 3);
      const [nx, ny, nz] = normals.subarray(i * 3, i * 3 + 3);
      if (stretch[i] !== Math.fround(stretchAt(model.circumference, y))) {
        throw new Error("stretch at " + i);
      }
      if (skinFx[i * 2] !== 0 || skinFx[i * 2 + 1] !== Math.fround(bonyAt(x, y, z, nx, ny, nz))) {
        throw new Error("skinFx at " + i);
      }
    }
    // The same stretch as the stocking at that height.
    const stockingStretch = new Set(model.stocking.attributes.stretch.array);
    expect([...new Set(stretch)].filter((value) => !stockingStretch.has(value))).toEqual([]);
    const [minBony, maxBony] = extent(skinFx);
    expect(minBony).toBe(0);
    expect(maxBony).toBeGreaterThan(0.3);
    expect(maxBony).toBeLessThanOrEqual(1);
  });

  it("has separate toes", () => {
    const geometry = forefoot();
    const positions = geometry.attributes.position.array;
    const tips = pieces(geometry, (v) => positions[v * 3 + 2] > 0.185);
    expect(new Set(tips.values()).size).toBeGreaterThanOrEqual(3);
    // The whole forefoot is one piece.
    const whole = pieces(geometry, () => true);
    expect(new Set(whole.values()).size).toBe(1);
  });

  it("puts each toenail on the skin of its own toe", () => {
    const model = legModel();
    const geometry = forefoot();
    const positions = geometry.attributes.position.array;
    const distance = (v: number, point: readonly number[]): number =>
      Math.hypot(positions[v * 3] - point[0], positions[v * 3 + 1] - point[1], positions[v * 3 + 2] - point[2]);
    const skin = surfaceOf(geometry);
    for (const nail of model.nails) {
      const hit = skin.closest(nail.center[0], nail.center[1], nail.center[2], 0.01)!;
      expect(hit.dist).toBeLessThan(0.001);
      expect(dot([hit.nx, hit.ny, hit.nz], nail.normal)).toBeGreaterThan(0.9);
    }
    // Balls of 12 mm around the nails overlap from toe to toe, but the skin inside them does not connect.
    const reach = 0.012;
    const gaps = model.nails
      .slice(1)
      .map((nail, i) => Math.hypot(...nail.center.map((c, k) => c - model.nails[i].center[k])));
    expect(Math.max(...gaps)).toBeLessThan(reach * 2);
    const around = pieces(geometry, (v) => model.nails.some((nail) => distance(v, nail.center) < reach));
    const toes = model.nails.map((nail) => {
      let nearest = -1;
      for (const v of around.keys()) {
        if (nearest < 0 || distance(v, nail.center) < distance(nearest, nail.center)) {
          nearest = v;
        }
      }
      expect(distance(nearest, nail.center)).toBeLessThan(0.002);
      return around.get(nearest);
    });
    expect(new Set(toes).size).toBe(5);
  });
});

describe("buildForefootCollision on a flat cage", () => {
  const build = (collision = flatStocking(-0.002, [0, 1, 0])): ForefootCollision =>
    buildForefootCollision(flatCage(0.005), flatStocking(0, TILT), collision);

  it("subdivides the cage once and keeps the quads that reach in front of the cut", () => {
    const { pos, nrm, uv, idx, uvTri } = build();
    // Rows of 4 quads of 5 mm from z = 0.09 on: those from z = 0.11 reach past the cut at 0.112.
    expect(pos.length / 3).toBe(5 * 9);
    expect(idx.length / 6).toBe(4 * 8);
    expect([nrm.length, uv.length, uvTri.length]).toEqual([pos.length, (pos.length / 3) * 2, idx.length / 3]);
    for (const array of [pos, nrm, uv]) {
      expect(array).toBeInstanceOf(Float32Array);
    }
    expect(idx).toBeInstanceOf(Uint32Array);
    expect(uvTri).toBeInstanceOf(Int32Array);
    expect(topologyProblems(idx, pos.length / 3)).toEqual([]);
    // Only the vertices in use, each at least once.
    expect(new Set(idx).size).toBe(pos.length / 3);
    expect(extent(pos.filter((_, i) => i % 3 === 0))).toEqual([-0.01, 0.01].map(Math.fround));
    const [minZ, maxZ] = extent(pos.filter((_, i) => i % 3 === 2));
    expect(minZ).toBeCloseTo(0.11, 6);
    expect(maxZ).toBeCloseTo(0.15, 6);
    for (let q = 0; q < idx.length; q += 6) {
      const quad = [idx[q], idx[q + 1], idx[q + 2], idx[q + 5]];
      expect(quad.some((v) => pos[v * 3 + 2] > FOREFOOT_JOIN.cut)).toBe(true);
    }
  });

  it("is the surface the render geometry has: on the stocking behind the cut, lit like it", () => {
    const { pos, nrm, uv, idx } = build();
    const render = buildForefoot(flatCage(0.005), flatStocking(0, TILT), flatStocking(-0.002, [0, 1, 0]), [0.5]);
    const surface = surfaceOf(render);
    const seen = { on: 0, own: 0 };
    for (let v = 0; v < pos.length / 3; v++) {
      const [x, y, z] = pos.subarray(v * 3, v * 3 + 3);
      const normal = [...nrm.subarray(v * 3, v * 3 + 3)];
      expect(Math.hypot(...normal)).toBeCloseTo(1, 6);
      expect(uv[v * 2]).toBeCloseTo((x + 0.05) / 0.1, 5);
      expect(uv[v * 2 + 1]).toBeCloseTo((z - 0.05) / 0.2, 5);
      // The corners of the cage's open front round off a little more with each subdivision; the rest is flat.
      const hit = surface.closest(x, y, z, 0.01)!;
      expect(hit.dist).toBeLessThan(z > 0.14 ? 0.0005 : 0.00001);
      if (z <= FOREFOOT_JOIN.cut) {
        expect(y).toBe(0);
        expect(normal).toEqual(TILT.map(Math.fround));
        seen.on++;
      } else if (z >= FOREFOOT_JOIN.to) {
        expect(y).toBe(Math.fround(0.005));
        expect(normal).toEqual([0, 1, 0]);
        seen.own++;
      }
    }
    expect(seen.on).toBe(5);
    expect(seen.own).toBeGreaterThanOrEqual(5 * 4);
    // The triangles face up, like the render geometry's.
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((v) => [...pos.subarray(v * 3, v * 3 + 3)]);
      const ab = b.map((value, k) => value - a[k]);
      const ac = c.map((value, k) => value - a[k]);
      expect(ab[2] * ac[0] - ab[0] * ac[2]).toBeGreaterThan(0);
    }
  });

  it("names the collision triangle each of its triangles takes its UVs from", () => {
    const { pos, idx, uvTri } = build();
    // flatStocking() has two triangles, split along x - z: 0 2 1 on the far side and 0 3 2 on the near side.
    expect(new Set(uvTri)).toEqual(new Set([0, 1]));
    const seamed = build(seamedStocking(-0.002));
    expect(seamed.pos.length).toBeGreaterThan(pos.length);
    expect(seamed.idx.length).toBe(idx.length);
    for (let t = 0; t < seamed.uvTri.length; t++) {
      const corners = [seamed.idx[t * 3], seamed.idx[t * 3 + 1], seamed.idx[t * 3 + 2]];
      // Triangles 0 and 1 of seamedStocking() are its left island, 2 and 3 its right one.
      const side = seamed.uvTri[t] < 2 ? 0 : 1;
      for (const v of corners) {
        expect(seamed.uv[v * 2]).toBeCloseTo(seamedU(seamed.pos[v * 3])[side], 5);
      }
    }
    expect(new Set(seamed.uvTri).size).toBeGreaterThanOrEqual(2);
    expect(new Set([...seamed.uvTri].map((tri) => tri < 2))).toEqual(new Set([true, false]));
  });

  it("names no triangle where no stocking is within reach", () => {
    const far = buildForefootCollision(flatCage(0.05), flatStocking(0, TILT), flatStocking(-0.002, [0, 1, 0]));
    expect(new Set(far.uvTri)).toEqual(new Set([-1]));
    expect(new Set(far.uv)).toEqual(new Set([-1]));
    expect(far.idx.length / 6).toBe(4 * 8);
  });
});

describe("buildForefootCollision on the shipped model", () => {
  it("is a coarser mesh of the same skin, from the cut forward", () => {
    const { pos, nrm, uv, idx, uvTri } = skinCollision();
    const count = pos.length / 3;
    expect([nrm.length, uv.length, uvTri.length]).toEqual([count * 3, count * 2, idx.length / 3]);
    expect(topologyProblems(idx, count)).toEqual([]);
    expect(new Set(idx).size).toBe(count);
    // One subdivision level less than the render geometry: about a quarter of its triangles.
    const renderTris = forefoot().index!.count / 3;
    expect(idx.length / 3).toBeGreaterThan(renderTris / 6);
    expect(idx.length / 3).toBeLessThan(renderTris / 3);
    const skin = surfaceOf(forefoot());
    const stocking = surfaceOf(legModel().stocking);
    let behind = 0;
    for (let v = 0; v < count; v++) {
      const [x, y, z] = pos.subarray(v * 3, v * 3 + 3);
      const normal = [...nrm.subarray(v * 3, v * 3 + 3)];
      if (Math.abs(Math.hypot(...normal) - 1) > 1e-4) {
        throw new Error("non-unit normal at " + v);
      }
      if (z <= FOREFOOT_JOIN.cut) {
        // Behind the cut it is the stocking's surface, as far back as its quads reach.
        behind++;
        const hit = stocking.closest(x, y, z, 0.01);
        if (!hit || hit.dist > 0.00005 || dot([hit.nx, hit.ny, hit.nz], normal) < 0.999) {
          throw new Error("vertex " + v + " is off the stocking");
        }
      } else {
        // In front of it, the skin as it is drawn, to within the roundness one more subdivision adds.
        const hit = skin.closest(x, y, z, 0.01);
        if (!hit || hit.dist > 0.0008 || dot([hit.nx, hit.ny, hit.nz], normal) < 0.95) {
          throw new Error("vertex " + v + " is off the skin: " + hit?.dist);
        }
      }
    }
    expect(behind).toBeGreaterThan(20);
    expect(extent(pos.filter((_, i) => i % 3 === 2))[0]).toBeGreaterThan(FOREFOOT_JOIN.cut - 0.02);
    for (let q = 0; q < idx.length; q += 6) {
      if (![0, 1, 2, 5].some((k) => pos[idx[q + k] * 3 + 2] > FOREFOOT_JOIN.cut)) {
        throw new Error("quad " + q / 6 + " lies behind the cut");
      }
    }
  });

  it("has the separate toes of the render geometry", () => {
    const { pos, nrm, uv, idx } = skinCollision();
    const skin = new SurfaceGrid({ pos, nrm, uv, idx }, 0.004);
    const model = legModel();
    for (const nail of model.nails) {
      const hit = skin.closest(nail.center[0], nail.center[1], nail.center[2], 0.01)!;
      expect(hit.dist).toBeLessThan(0.001);
      expect(dot([hit.nx, hit.ny, hit.nz], nail.normal)).toBeGreaterThan(0.9);
    }
    // Between two nails and 2 cm behind them, a ray straight down passes between the toes; the stocking
    // stretched over them stops it.
    const stocking = new SurfaceGrid(model.collision);
    for (let toe = 0; toe + 1 < model.nails.length; toe++) {
      const [a, b] = [model.nails[toe].center, model.nails[toe + 1].center];
      const z = Math.min(a[2], b[2]) - 0.02;
      const xs = Array.from({ length: 41 }, (_, k) => a[0] + ((b[0] - a[0]) * k) / 40);
      expect(xs.filter((x) => !skin.raycast(x, 0.1, z, 0, -1, 0)).length).toBeGreaterThanOrEqual(2);
      expect(xs.filter((x) => !stocking.raycast(x, 0.1, z, 0, -1, 0))).toEqual([]);
    }
  });

  it("keeps every triangle's UVs together, near the stocking triangle it names", () => {
    const { uv, idx, uvTri } = skinCollision();
    const collision = legModel().collision;
    // Twice the size of the render geometry's triangles, so twice as far apart in the UVs.
    expect(Math.max(...uvSpans(uv, idx))).toBeLessThan(0.05);
    const [minUv, maxUv] = extent(uv);
    expect(minUv).toBeGreaterThanOrEqual(0);
    expect(maxUv).toBeLessThanOrEqual(1);
    for (let t = 0; t < uvTri.length; t++) {
      const tri = uvTri[t];
      if (!(tri >= 0 && tri < collision.idx.length / 3)) {
        throw new Error("triangle " + t + " names the stocking triangle " + tri);
      }
      for (const axis of [0, 1]) {
        const named = [0, 1, 2].map((k) => collision.uv[collision.idx[tri * 3 + k] * 2 + axis]);
        const own = [0, 1, 2].map((k) => uv[idx[t * 3 + k] * 2 + axis]);
        if (Math.min(...own) > Math.max(...named) + 0.03 || Math.max(...own) < Math.min(...named) - 0.03) {
          throw new Error("triangle " + t + " is far from the stocking triangle " + tri + " in the UVs");
        }
      }
    }
  });
});

describe("frontOfJoin", () => {
  it("keeps the stocking's triangles in front of the join, sharing its attributes", () => {
    const stocking = legModel().stocking;
    const front = frontOfJoin(stocking);
    for (const name of Object.keys(stocking.attributes)) {
      expect(front.attributes[name]).toBe(stocking.attributes[name]);
    }
    const positions = stocking.attributes.position.array;
    const kept = front.index!.array;
    expect(kept.length).toBeGreaterThan(3000);
    expect(kept.length).toBeLessThan(stocking.index!.array.length / 2);
    let reach = -Infinity;
    for (let t = 0; t < kept.length; t += 3) {
      const corners = [kept[t], kept[t + 1], kept[t + 2]];
      // In front of the join, on the foot: the knee and the thigh reach as far forward.
      expect(Math.max(...corners.map((v) => positions[v * 3 + 2]))).toBeGreaterThan(FOREFOOT_JOIN.cut - 0.001);
      reach = Math.max(reach, ...corners.map((v) => positions[v * 3 + 1]));
    }
    expect(reach).toBeLessThan(FOREFOOT_JOIN.maxY);
  });
});

describe("buildLegModel forefoot", () => {
  it("has no forefoot and no nails for a model without forefoot data", () => {
    const model = buildLegModel({ ...modelData(), forefoot: null });
    expect(model.forefoot).toBeNull();
    expect(model.forefootCollision).toBeNull();
    expect(model.nails).toEqual([]);
    expect(buildLegModel(tinyModelData(), { levels: 1 }).forefoot).toBeNull();
    // The stocking does not depend on the forefoot.
    const full = legModel().stocking;
    expect(model.stocking.index!.array).toEqual(full.index!.array);
    for (const name of FOREFOOT_ATTRIBUTES) {
      expect(model.stocking.attributes[name].array).toEqual(full.attributes[name].array);
    }
  });

  it("builds a forefoot with or without nails", () => {
    const nails = [{ center: [0, 0, 0.15], normal: [0, 1, 0], forward: [0, 0, 1], half: [0.004, 0.004] }];
    const without = buildLegModel({ ...tinyModelData(), forefoot: flatCage(0.005) }, { levels: 1 });
    const withNails = buildLegModel({ ...tinyModelData(), forefoot: { ...flatCage(0.005), nails } }, { levels: 1 });
    expect(without.nails).toEqual([]);
    expect(withNails.nails).toBe(nails);
    for (const model of [without, withNails]) {
      expect(Object.keys(model.forefoot!.attributes).sort()).toEqual(FOREFOOT_ATTRIBUTES);
      expect(model.forefoot!.attributes.position.count).toBe(225);
      expect(model.forefootCollision!.idx.length / 6).toBe(4 * 8);
    }
  });
});

describe("stretchAt", () => {
  const circumference = [0.34, 0.68, 0.17];

  it("divides the circumference of the 1 cm bin at that height by the 0.34 m reference", () => {
    expect(stretchAt(circumference, 0.005)).toBe(1);
    expect(stretchAt(circumference, 0.015)).toBe(2);
    expect(stretchAt(circumference, 0.0199)).toBe(2);
    expect(stretchAt(circumference, 0.025)).toBe(0.5);
    expect(stretchAt([0.1], 0)).toBe(0.1 / 0.34);
  });

  it("clamps below the floor and above the last bin", () => {
    expect(stretchAt(circumference, -0.5)).toBe(1);
    expect(stretchAt(circumference, -0.001)).toBe(1);
    expect(stretchAt(circumference, 0.03)).toBe(0.5);
    expect(stretchAt(circumference, 7)).toBe(0.5);
  });

  it("matches the stretch attribute of the stocking", () => {
    const model = legModel();
    const positions = model.stocking.attributes.position.array;
    const stretch = model.stocking.attributes.stretch.array;
    for (let i = 0; i < stretch.length; i++) {
      if (stretch[i] !== Math.fround(stretchAt(model.circumference, positions[i * 3 + 1]))) {
        throw new Error("stretch differs at " + i);
      }
    }
  });
});

describe("bonyAt", () => {
  const heel = [0.006, 0.028, -0.04];
  const back = [0, -0.3, -0.95].map((c) => c / Math.hypot(0.3, 0.95));

  it("is positive on the back of the heel and fades with distance", () => {
    const center = bonyAt(heel[0], heel[1], heel[2], back[0], back[1], back[2]);
    expect(center).toBeCloseTo(0.8, 6);
    const near = bonyAt(heel[0] + 0.02, heel[1], heel[2], back[0], back[1], back[2]);
    expect(near).toBeGreaterThan(0.3);
    expect(near).toBeLessThan(center);
    expect(bonyAt(heel[0] + 0.2, heel[1], heel[2], back[0], back[1], back[2])).toBe(0);
    expect(bonyAt(heel[0], heel[1] + 0.3, heel[2], back[0], back[1], back[2])).toBe(0);
    expect(bonyAt(5, 5, 5, 0, 0, 1)).toBe(0);
  });

  it("only counts skin that faces the way the bone does", () => {
    expect(bonyAt(heel[0], heel[1], heel[2], -back[0], -back[1], -back[2])).toBe(0);
    expect(bonyAt(heel[0], heel[1], heel[2], 1, 0, 0)).toBe(0);
    const oblique = bonyAt(heel[0], heel[1], heel[2], 0, -1, 0);
    expect(oblique).toBeGreaterThan(0);
    expect(oblique).toBeLessThan(0.8);
  });

  it("is 1 on the kneecap and never leaves [0, 1]", () => {
    expect(bonyAt(-0.003, 0.49, 0.075, 0, 0, 1)).toBe(1);
    for (let i = 0; i < 2000; i++) {
      const theta = i * 0.37;
      const phi = i * 1.13;
      const normal = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      const value = bonyAt(
        Math.sin(i * 0.7) * 0.06,
        ((i * 0.618) % 1) * 0.6,
        Math.cos(i * 0.3) * 0.1 + 0.05,
        normal[0],
        normal[1],
        normal[2],
      );
      if (!(value >= 0 && value <= 1)) {
        throw new Error("out of range at " + i + ": " + value);
      }
    }
  });

  it("matches the bony factor the stocking was built with", () => {
    const [minBony, maxBony] = extent(legModel().stocking.attributes.skinFx.array.filter((_, i) => i % 2 === 1));
    expect(minBony).toBe(0);
    expect(maxBony).toBeGreaterThan(0.9);
    expect(maxBony).toBeLessThanOrEqual(1);
  });
});
