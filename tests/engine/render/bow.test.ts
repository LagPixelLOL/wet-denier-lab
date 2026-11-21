import { describe, expect, it } from "vitest";
import { STOCKING_LENGTHS } from "../../../src/engine/catalog/garments";
import { BOW_SEAT, computeBowMatrix, createBowGeometry } from "../../../src/engine/stage/bow";
import { SurfaceGrid } from "../../../src/engine/surface/SurfaceGrid";
import { digest, digestRounded } from "../../helpers/digest";
import { legModel } from "../../helpers/model";

describe("createBowGeometry", () => {
  const geometry = createBowGeometry();
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;

  it("builds two loops, two tails and a closed knot", () => {
    // loops 29x7 vertices, tails 5x7, knot 13x7
    expect(position.count).toBe(2 * 29 * 7 + 2 * 5 * 7 + 13 * 7);
    expect(geometry.index?.count).toBe((2 * 28 * 6 + 2 * 4 * 6 + 12 * 6) * 6);
  });

  it("is a small mirrored shape in front of the z = 0 plane", () => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.min.x).toBeCloseTo(-box.max.x, 6);
    expect(box.max.x).toBeLessThan(0.03);
    expect(box.min.z).toBeGreaterThan(0);
    expect(box.max.z).toBeLessThan(0.01);
  });

  it("averages the normals along the knot seam", () => {
    const knotStart = 2 * 29 * 7 + 2 * 5 * 7;
    for (let row = 0; row <= 6; row++) {
      const first = knotStart + row * 13;
      const last = first + 12;
      expect([normal.getX(first), normal.getY(first), normal.getZ(first)]).toEqual([
        normal.getX(last),
        normal.getY(last),
        normal.getZ(last),
      ]);
    }
  });

  it("produces the pinned vertex data", () => {
    expect(digest(position.array)).toMatchInlineSnapshot(`"a1f90dd1"`);
    expect(digestRounded(normal.array, 5)).toMatchInlineSnapshot(`"9d2a8c08"`);
  });
});

describe("computeBowMatrix", () => {
  const collision = legModel().collision;

  it("places an orthonormal frame on the cuff ring", () => {
    const cuffY = STOCKING_LENGTHS.thigh.cuffY;
    const m = computeBowMatrix(collision, cuffY);
    const axis = (i: number) => [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const [tangent, bitangent, normal] = [axis(0), axis(1), axis(2)];
    expect(tangent[1]).toBe(0);
    for (const v of [tangent, bitangent]) {
      expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    }
    expect(dot(tangent, normal)).toBeCloseTo(0, 6);
    expect(dot(bitangent, normal)).toBeCloseTo(0, 6);
    expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1]);
    // the bow's base sits 1.6 cm under the cuff, a little inside the surface
    expect(m[13]).toBeCloseTo(cuffY - 0.016 - normal[1] * BOW_SEAT, 9);
    // on the outer (+x) side of the leg
    expect(m[12]).toBeGreaterThan(0);
  });

  it("falls back to an x tangent when the anchor normal points straight up", () => {
    // a flat ring of four vertices at the ring height, all with an upward normal
    const ringY = 0.5 - 0.016;
    const pos = new Float32Array([0.05, ringY, 0, -0.05, ringY, 0, 0, ringY, 0.05, 0, ringY, -0.05]);
    const nrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const m = computeBowMatrix({ pos, nrm }, 0.5);
    expect([...m.subarray(0, 3)].map((v) => v + 0)).toEqual([0, 0, 0]);
    expect([...m.subarray(8, 11)]).toEqual([0, 1, 0]);
    expect(m[13]).toBeCloseTo(ringY - BOW_SEAT, 7);
  });

  it("puts the bow's base just inside the leg's surface, so its knot and tails rest on it", () => {
    const grid = new SurfaceGrid(collision, 0.01);
    for (const [key, def] of Object.entries(STOCKING_LENGTHS)) {
      if (key === "bare") {
        continue;
      }
      const m = computeBowMatrix(collision, def.cuffY);
      const normal = [m[8], m[9], m[10]];
      // Back out of the surface by as much as the base is seated into it: that point is on the surface, at
      // the ring's height. (Straight up or down from a vertex, as it once was placed, misses by up to 1 mm.)
      const on = [0, 1, 2].map((k) => m[12 + k] + normal[k] * BOW_SEAT);
      expect(on[1]).toBeCloseTo(def.cuffY - 0.016, 9);
      const hit = grid.closest(on[0], on[1], on[2], 0.01)!;
      expect([key, Math.hypot(hit.x - on[0], hit.y - on[1], hit.z - on[2]) < 0.00015]).toEqual([key, true]);
      // The frame's normal is the surface's there, to within a few degrees.
      expect(hit.nx * normal[0] + hit.ny * normal[1] + hit.nz * normal[2]).toBeGreaterThan(0.99);
    }
    // Nothing of the bow is lower than that: its loops' edges and its tails' ends are at the fabric's level,
    // and the knot starts 0.4 mm above it.
    const z = createBowGeometry().attributes.position.array.filter((_, i) => i % 3 === 2);
    const [loops, tails, knot] = [
      z.slice(0, 2 * 29 * 7),
      z.slice(2 * 29 * 7, 2 * 29 * 7 + 2 * 5 * 7),
      z.slice(-13 * 7),
    ];
    expect(Math.min(...loops)).toBeCloseTo(BOW_SEAT, 9);
    expect(Math.min(...tails)).toBeGreaterThanOrEqual(BOW_SEAT);
    expect(Math.min(...tails) - BOW_SEAT).toBeLessThan(0.00005);
    expect(Math.min(...knot) - BOW_SEAT).toBeCloseTo(0.0004, 9);
  });

  it("writes into the given array and pins the placement for each stocking length", () => {
    const out = new Float64Array(16);
    expect(computeBowMatrix(collision, STOCKING_LENGTHS.thigh.cuffY, out)).toBe(out);
    // Bare legs have no cuff to tie a bow to.
    const results = Object.entries(STOCKING_LENGTHS)
      .filter(([key]) => key !== "bare")
      .map(([key, def]) => `${key}: ${digestRounded(computeBowMatrix(collision, def.cuffY), 6)}`);
    expect(results).toMatchInlineSnapshot(`
      [
        "ankle: bb4a4c8d",
        "crew: 775b1363",
        "knee: 23da09b7",
        "over: d596d613",
        "thigh: 62610905",
        "tights: 62610905",
      ]
    `);
  });
});
