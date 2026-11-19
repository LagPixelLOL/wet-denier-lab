import { describe, expect, it } from "vitest";
import { STOCKING_LENGTHS } from "../../../src/engine/catalog/garments";
import { computeBowMatrix, createBowGeometry } from "../../../src/engine/stage/bow";
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
    expect(digest(position.array)).toMatchInlineSnapshot(`"f6a70a19"`);
    expect(digestRounded(normal.array, 5)).toMatchInlineSnapshot(`"ec48fd02"`);
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
    // the anchor sits 1.6 cm under the cuff, nudged 0.4 mm along the normal
    expect(m[13]).toBeCloseTo(cuffY - 0.016 + normal[1] * 0.0004, 9);
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
    expect(m[13]).toBeCloseTo(ringY + 0.0004, 7);
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
        "ankle: 207c21aa",
        "crew: e98b6f0f",
        "knee: 861ab584",
        "over: 42499e44",
        "thigh: 78737ebe",
        "tights: 78737ebe",
      ]
    `);
  });
});
