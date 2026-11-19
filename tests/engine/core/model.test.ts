import { Buffer } from "node:buffer";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAnatomyBumps,
  computeLegAxisProfile,
  HEEL,
  inflateThigh,
  INSTEP,
  shapeHeel,
  slimInstep,
} from "../../../src/engine/model/anatomy";
import { parseModelGlb } from "../../../src/engine/model/glb";
import type { ModelData } from "../../../src/engine/model/glb";
import { buildLegModel, loadLegModel } from "../../../src/engine/model/legModel";
import type { LegModel } from "../../../src/engine/model/legModel";
import { computeCircumference, computeLegTangents } from "../../../src/engine/model/tangents";
import { applyWrapOffsets, decodeBase64Int16 } from "../../../src/engine/model/wrapOffsets";
import { weldVertices } from "../../../src/engine/geometry/weld";
import { digest, digestRounded } from "../../helpers/digest";
import { legModel, modelData, readModelBuffer } from "../../helpers/model";
import { buildGlb, tinyGlb, tinyModelData, topologyProblems, tube } from "./fixtures";

const toBase64 = (array: Int16Array): string =>
  Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("base64");

function attributeDigests(geometry: THREE.BufferGeometry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(geometry.attributes).sort()) {
    out[name] = digestRounded(geometry.attributes[name].array, 6);
  }
  return out;
}

function asView(array: ArrayLike<number> | null | undefined): ArrayBufferView {
  if (!ArrayBuffer.isView(array)) {
    throw new Error("expected a typed array");
  }
  return array;
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

function geometryWith(normals: number[], positions = new Array<number>(normals.length).fill(0)): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  return geometry;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseModelGlb", () => {
  it("reads the stocking, skin top and wrap offsets of the shipped model", () => {
    const data = modelData();
    expect(data.stocking.positions).toBeInstanceOf(Float32Array);
    expect(data.stocking.uvs).toBeInstanceOf(Float32Array);
    expect(data.stocking.indices).toBeInstanceOf(Uint16Array);
    expect(data.wrapData).toBeInstanceOf(Int16Array);
    expect({
      stockingVertices: data.stocking.positions.length / 3,
      stockingUvs: data.stocking.uvs.length / 2,
      stockingTris: data.stocking.indices.length / 3,
      skinVertices: data.skinTop.positions.length / 3,
      skinTris: data.skinTop.indices.length / 3,
      wrapVertices: data.wrapData!.length / 4,
    }).toMatchInlineSnapshot(`
      {
        "skinTris": 1950,
        "skinVertices": 1076,
        "stockingTris": 7808,
        "stockingUvs": 4086,
        "stockingVertices": 4086,
        "wrapVertices": 63186,
      }
    `);
  });

  it("pins the raw arrays of the shipped model", () => {
    const data = modelData();
    const arrays = [
      data.stocking.positions,
      data.stocking.uvs,
      data.stocking.indices,
      data.skinTop.positions,
      data.skinTop.indices,
      data.wrapData,
    ].map(asView);
    expect(arrays.map(digest)).toMatchInlineSnapshot(`
      [
        "391b2cb2",
        "f9851940",
        "e7ecf9f5",
        "6f7a6d70",
        "0c6f6798",
        "42147833",
      ]
    `);
  });

  it("rejects a buffer with the wrong magic", () => {
    const buffer = readModelBuffer();
    new DataView(buffer).setUint32(0, 0x12345678, true);
    expect(() => parseModelGlb(buffer)).toThrow("not a glTF 2.0 binary");
  });

  it("rejects glTF binaries of another version", () => {
    expect(() => parseModelGlb(buildGlb([], [], { version: 1 }))).toThrow("not a glTF 2.0 binary");
    expect(() => parseModelGlb(buildGlb([], [], { magic: 0 }))).toThrow("not a glTF 2.0 binary");
  });

  it("names the mesh that is missing", () => {
    expect(() => parseModelGlb(buildGlb([], [{ name: "skinTop", primitives: [] }]))).toThrow(
      'model has no "stocking" mesh',
    );
    expect(() => parseModelGlb(buildGlb([], [{ name: "stocking", primitives: [{ attributes: {} }] }]))).toThrow(
      'model has no "skinTop" mesh',
    );
  });

  it("reads accessors with and without buffer view and accessor offsets", () => {
    const source = tinyModelData();
    const data = parseModelGlb(tinyGlb());
    expect(Array.from(data.stocking.positions)).toEqual(Array.from(source.stocking.positions));
    expect(Array.from(data.stocking.uvs)).toEqual(Array.from(source.stocking.uvs));
    expect(Array.from(data.stocking.indices)).toEqual(Array.from(source.stocking.indices));
    expect(Array.from(data.skinTop.positions)).toEqual(Array.from(source.skinTop.positions));
    expect(data.skinTop.indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(data.skinTop.indices)).toEqual(Array.from(source.skinTop.indices));
  });

  it("returns null wrap data when the stocking has no wrapOffsets extra", () => {
    expect(parseModelGlb(tinyGlb()).wrapData).toBeNull();
    const wrap = Int16Array.from({ length: 96 * 4 }, (_, i) => i - 100);
    expect(Array.from(parseModelGlb(tinyGlb(wrap)).wrapData ?? [])).toEqual([...wrap]);
  });
});

describe("wrap offsets", () => {
  it("decodes little-endian Int16 values from base64", () => {
    expect([...decodeBase64Int16(toBase64(Int16Array.of(1, -1, 32767, -32768)))]).toEqual([1, -1, 32767, -32768]);
    expect(decodeBase64Int16("").length).toBe(0);
  });

  it("falls back to Buffer when atob is unavailable", () => {
    vi.stubGlobal("atob", undefined);
    expect([...decodeBase64Int16(toBase64(Int16Array.of(513, -2)))]).toEqual([513, -2]);
  });

  it("returns an unchanged copy and zero gap/nail without wrap data", () => {
    const positions = Float32Array.of(1, 2, 3);
    const wrapped = applyWrapOffsets(positions, null);
    expect(wrapped.pos).not.toBe(positions);
    expect([...wrapped.pos]).toEqual([1, 2, 3]);
    expect([...wrapped.gapNail]).toEqual([0, 0]);
  });

  it("offsets positions in 1e-5 units and unpacks gap (high bits) and nail (low 4 bits)", () => {
    const wrapped = applyWrapOffsets([0, 0, 0, 1, 1, 1], [100, -200, 300, (5 << 4) | 15, 1, 1, 1, -16]);
    expect([...wrapped.pos].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([
      0.001, -0.002, 0.003, 1.00001, 1.00001, 1.00001,
    ]);
    expect(wrapped.gapNail[0]).toBeCloseTo(0.0001, 9);
    expect(wrapped.gapNail[1]).toBe(1);
    expect(wrapped.gapNail[2]).toBeCloseTo(-0.00002, 9);
    expect(wrapped.gapNail[3]).toBe(0);
  });

  it("only touches the vertices covered by the wrap data", () => {
    const wrapped = applyWrapOffsets([0, 0, 0, 5, 5, 5], [1000, 0, 0, 3]);
    expect([...wrapped.pos]).toEqual([Math.fround(0.01), 0, 0, 5, 5, 5]);
    expect(wrapped.gapNail[3]).toBe(0);
  });
});

describe("computeLegAxisProfile", () => {
  it("follows the per-centimetre centre of a tube", () => {
    const leg = tube(0.05, 0.005, 0.995, 100, 16, 0.02, -0.01);
    const profile = computeLegAxisProfile(leg.pos);
    expect(profile.length).toBe(200);
    for (let bin = 0; bin < 100; bin++) {
      expect(profile[bin * 2]).toBeCloseTo(0.02, 6);
      expect(profile[bin * 2 + 1]).toBeCloseTo(-0.01, 6);
    }
  });

  it("carries the last centre into empty bins, clamps out-of-range heights and smooths the jumps", () => {
    // One point below the floor (bin 0), one at 0.5 m and one above the top (bin 99).
    const profile = computeLegAxisProfile([1, -1, 1, 2, 0.505, 2, 3, 5, 3]);
    expect(profile[0]).toBeCloseTo(1, 1);
    expect(profile[30 * 2]).toBe(1);
    expect(profile[70 * 2 + 1]).toBe(2);
    expect(profile[99 * 2]).toBeGreaterThan(2.5);
    expect(profile[50 * 2]).toBeGreaterThan(1);
    expect(profile[50 * 2]).toBeLessThan(2);
  });
});

describe("inflateThigh", () => {
  const axis = new Float64Array(200);

  it("leaves everything at or below the knee crease alone and returns the same array", () => {
    const positions = Float32Array.of(0.05, 0.3, 0, 0.05, 0.46, 0);
    expect(inflateThigh(positions, axis)).toBe(positions);
    expect([...positions]).toEqual([0.05, 0.3, 0, 0.05, 0.46, 0].map(Math.fround));
  });

  it("pushes thigh points outward, more at the back and inner side than at the front", () => {
    const positions = Float32Array.of(0.05, 0.9, 0, -0.05, 0.9, 0, 0, 0.9, 0.05, 0, 0.9, -0.05);
    inflateThigh(positions, axis);
    const outer = positions[0] / 0.05 - 1;
    const inner = -positions[3] / 0.05 - 1;
    const front = positions[8] / 0.05 - 1;
    const back = -positions[11] / 0.05 - 1;
    expect(outer).toBeCloseTo(0.095 * 0.62, 6);
    expect(inner).toBeCloseTo(0.095 * 0.97, 6);
    expect(front).toBeCloseTo(0.095 * 0.42, 6);
    expect(back).toBeCloseTo(0.095 * 1.17, 6);
  });

  it("eases the inflation in with height and keeps points on the axis in place", () => {
    const positions = Float32Array.of(0.05, 0.64, 0, 0, 0.7, 0);
    inflateThigh(positions, axis);
    // Half-way up the ramp the smoothstep is exactly 0.5.
    expect(positions[0] / 0.05 - 1).toBeCloseTo(0.5 * 0.095 * 0.62, 6);
    expect([positions[3], positions[5]]).toEqual([0, 0]);
  });

  it("inflates around the interpolated axis profile", () => {
    const shifted = new Float64Array(200);
    for (let bin = 0; bin < 100; bin++) {
      shifted[bin * 2] = bin / 1000;
    }
    const positions = Float32Array.of(0.0705, 0.9, 0);
    inflateThigh(positions, shifted);
    // The axis at y = 0.9 sits at x = 0.0895, so the point is on the inner side.
    expect(positions[0]).toBeCloseTo(0.0895 - 0.019 * (1 + 0.095 * 0.97), 6);
  });
});

describe("slimInstep", () => {
  const moved = (rest: number[]): number[] => {
    const positions = Float32Array.from(rest);
    expect(slimInstep(positions)).toBe(positions);
    return rest.map((v, i) => positions[i] - v);
  };

  it("takes each dent's middle in by its amount along its direction, plus what the others add there", () => {
    for (const dent of INSTEP) {
      let dy = 0;
      let dz = 0;
      for (const other of INSTEP) {
        const reach = Math.exp(-(((dent.y - other.y) / other.radius) ** 2 + ((dent.z - other.z) / other.radius) ** 2));
        dy += other.dir[0] * other.amount * reach;
        dz += other.dir[1] * other.amount * reach;
      }
      const [x, y, z] = moved([0.01, dent.y, dent.z]);
      expect(x).toBeCloseTo(0, 8);
      expect(y).toBeCloseTo(dy, 6);
      expect(z).toBeCloseTo(dz, 6);
      // Down and back, into the leg.
      expect(y).toBeLessThan(-0.0009);
      expect(z).toBeLessThan(-0.0005);
    }
  });

  it("is deepest where the instep turns up into the shin, and shallow by the middle of the foot", () => {
    const size = (rest: number[]): number => Math.hypot(...moved(rest));
    const corner = size([0, 0.105, 0.054]);
    expect(corner).toBeGreaterThan(0.006);
    expect(corner).toBeLessThan(0.0065);
    const upTheShin = size([0, 0.127, 0.045]);
    const downTheInstep = size([0, 0.092, 0.065]);
    const midFoot = size([0, 0.07, 0.095]);
    expect(upTheShin).toBeGreaterThan(0.0015);
    expect(upTheShin).toBeLessThan(downTheInstep);
    expect(downTheInstep).toBeLessThan(corner);
    expect(midFoot).toBeGreaterThan(0.001);
    expect(midFoot).toBeLessThan(0.002);
  });

  it("leaves the shin, the toes, the sole and the heel where they are", () => {
    for (const offset of moved([0, 0.2, 0.04, 0, 0.05, 0.16, 0, 0.002, 0.07, 0, 0.04, -0.05, 0.03, 0.5, 0.02])) {
      expect(Math.abs(offset)).toBeLessThan(0.0001);
    }
  });
});

describe("shapeHeel", () => {
  const moved = (rest: number[]): number[] => {
    const positions = Float32Array.from(rest);
    expect(shapeHeel(positions)).toBe(positions);
    return rest.map((v, i) => positions[i] - v);
  };
  /** Runs with the heel's growth and lift only, without the rounding of its back. */
  const withoutRounding = <T>(run: () => T): T => {
    const round = HEEL.round;
    HEEL.round = [];
    try {
      return run();
    } finally {
      HEEL.round = round;
    }
  };
  const [cx, cy, cz] = HEEL.center;

  it("grows the heel backward and to both sides, most at the height of its middle", () => {
    withoutRounding(() => {
      const back = moved([cx, cy, cz - 0.034]);
      expect(back[0]).toBeCloseTo(0, 8);
      expect(back[1]).toBeCloseTo(0, 4);
      expect(back[2]).toBeCloseTo(-0.034 * HEEL.grow[1], 6);
      const sides = moved([cx + 0.035, cy, cz, cx - 0.035, cy, cz]);
      expect(sides[0]).toBeCloseTo(0.035 * HEEL.grow[0], 6);
      expect(sides[3]).toBeCloseTo(-0.035 * HEEL.grow[0], 6);
      expect(sides[2]).toBeCloseTo(0, 8);
      // More in length than in width.
      expect(HEEL.grow[1]).toBeGreaterThan(HEEL.grow[0]);
      // Less toward the Achilles tendon above it.
      const above = moved([cx, cy + 0.04, cz - 0.03]);
      expect(-above[2]).toBeGreaterThan(0.0003);
      expect(-above[2]).toBeLessThan(-back[2] * 0.4);
    });
  });

  it("rounds the heel underneath: the skin on the floor rises around the middle, which stays down", () => {
    withoutRounding(() => {
      const [, middle] = moved([cx, 0.002, cz]);
      expect(middle).toBeCloseTo(0, 8);
      const [, rim] = moved([cx, 0.002, cz - HEEL.rim]);
      expect(rim).toBeGreaterThan(HEEL.lift * 0.9);
      expect(rim).toBeLessThan(HEEL.lift);
      const [, halfway] = moved([cx + HEEL.rim / 2, 0.002, cz]);
      expect(halfway).toBeGreaterThan(rim * 0.2);
      expect(halfway).toBeLessThan(rim * 0.3);
      // Only the skin near the floor is lifted.
      expect(moved([cx, 0.04, cz - HEEL.rim])[1]).toBeLessThan(0.0001);
    });
  });

  it("rounds the back of the heel a little: in under the tendon, out at the corner above the sole", () => {
    const [shoulder, corner] = HEEL.round;
    const rounding = HEEL.round.map((dent) => {
      const rest = [cx, dent.y, dent.z];
      const grown = withoutRounding(() => moved(rest));
      const full = moved(rest);
      // The dent is measured from where the heel's growth put the vertex.
      const y = rest[1] + grown[1];
      const z = rest[2] + grown[2];
      let dy = 0;
      let dz = 0;
      for (const other of HEEL.round) {
        const reach = Math.exp(-(((y - other.y) / other.radius) ** 2 + ((z - other.z) / other.radius) ** 2));
        dy += other.dir[0] * other.amount * reach;
        dz += other.dir[1] * other.amount * reach;
      }
      expect(full[1] - grown[1]).toBeCloseTo(dy, 6);
      expect(full[2] - grown[2]).toBeCloseTo(dz, 6);
      expect(dent.amount).toBeGreaterThan(0.0005);
      expect(dent.amount).toBeLessThan(0.002);
      return [full[1] - grown[1], full[2] - grown[2]];
    });
    // The shoulder goes forward, into the leg; the corner goes back and a little down.
    expect(shoulder.dir[1]).toBeGreaterThan(0);
    expect(rounding[0][1]).toBeGreaterThan(0.0005);
    expect(corner.dir[1]).toBeLessThan(0);
    expect(rounding[1][1]).toBeLessThan(-0.0005);
    expect(rounding[1][0]).toBeLessThan(0);
  });

  it("leaves the rest of the foot and the leg where they are", () => {
    for (const offset of moved([0.03, 0.01, 0.04, 0, 0.05, 0.12, 0.02, 0.2, -0.04, 0, 0.5, 0])) {
      expect(Math.abs(offset)).toBeLessThan(0.00005);
    }
    // Along the foot the change fades out, from the heel to the arch.
    const fading = withoutRounding(() => [-0.02, 0, 0.02, 0.034].map((z) => moved([cx + 0.03, cy, z])[0]));
    expect(fading[0]).toBeCloseTo(0.03 * HEEL.grow[0], 6);
    expect(fading[1]).toBeLessThan(fading[0]);
    expect(fading[2]).toBeLessThan(fading[1]);
    expect(fading[3]).toBeLessThan(0.00002);
  });
});

describe("applyAnatomyBumps", () => {
  // A tiny +z facing triangle centred on the kneecap blob, a duplicate of its first vertex and a far triangle.
  const knee = [-0.003, 0.497, 0.08];
  const makeMesh = (facing: 1 | -1) => {
    const pos = Float32Array.of(
      knee[0] - 0.001,
      knee[1] - 0.001,
      knee[2],
      knee[0] + 0.001,
      knee[1] - 0.001,
      knee[2],
      knee[0],
      knee[1] + 0.001,
      knee[2],
      knee[0] - 0.001,
      knee[1] - 0.001,
      knee[2],
      0,
      2,
      0,
      1,
      2,
      0,
      0,
      3,
      0,
    );
    const idx = facing === 1 ? [0, 1, 2, 4, 5, 6] : [0, 2, 1, 4, 5, 6];
    return { pos, idx, weld: weldVertices(pos) };
  };

  it("raises the kneecap along its normal and marks it bony", () => {
    const { pos, idx, weld } = makeMesh(1);
    const z0 = pos[2];
    const skinFx = applyAnatomyBumps(pos, idx, weld);
    const raise = pos[2] - z0;
    expect(raise).toBeGreaterThan(0.001);
    expect(raise).toBeLessThan(0.003);
    expect(skinFx[0]).toBe(-1);
    expect(skinFx[1]).toBeGreaterThan(0.9);
    // The welded duplicate follows its canonical vertex exactly.
    expect([...pos.slice(9, 12)]).toEqual([...pos.slice(0, 3)]);
    expect(skinFx[6]).toBe(skinFx[0]);
    // Both factors come from the canonical vertex before it moved, so seam duplicates match exactly.
    expect(skinFx[7]).toBe(skinFx[1]);
  });

  it("does nothing to surfaces facing away from a bump or far from every blob", () => {
    const { pos, idx, weld } = makeMesh(-1);
    const before = [...pos];
    const skinFx = applyAnatomyBumps(pos, idx, weld);
    expect([...pos]).toEqual(before);
    expect(skinFx.every((v) => v === 0)).toBe(true);
  });

  it("pins the kneecap displacement", () => {
    const { pos, idx, weld } = makeMesh(1);
    const skinFx = applyAnatomyBumps(pos, idx, weld);
    expect([digestRounded(pos, 7), digestRounded(skinFx, 6)]).toMatchInlineSnapshot(`
      [
        "1f248618",
        "cd7cfe43",
      ]
    `);
  });
});

describe("computeLegTangents", () => {
  const tangentsOf = (geometry: THREE.BufferGeometry) =>
    [...geometry.attributes.legTangent.array].map((v) => Math.round(v * 1e6) / 1e6 + 0);

  it("points up the leg above the ankle and forward along the foot, whichever way the surface faces", () => {
    const leg = [0, 0.5, 0];
    const foot = [0.01, 0.03, 0.15];
    const geometry = geometryWith(
      [1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, -1, 0, 1, 0, 0],
      [...leg, ...leg, ...leg, ...foot, ...foot, ...foot],
    );
    computeLegTangents(geometry);
    expect(tangentsOf(geometry)).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it("turns from up to forward around the crook of the ankle", () => {
    // As far below the crook (y 0.13) as behind it (z 0.09): halfway through the turn. Then nearer the leg,
    // and nearer the foot.
    const geometry = geometryWith([1, 0, 0, 1, 0, 0, 1, 0, 0], [0, 0.03, -0.01, 0, 0.1, -0.01, 0, 0.03, 0.06]);
    computeLegTangents(geometry);
    const t = tangentsOf(geometry);
    expect(t.slice(0, 3)).toEqual([0, 0.707107, 0.707107]);
    expect(t[4]).toBeGreaterThan(0.95);
    expect(t[8]).toBeGreaterThan(0.95);
  });

  it("takes another direction on the surface where the wales meet it head on", () => {
    // The tip of a toe faces forward, and the top of the thigh faces up.
    const geometry = geometryWith([0, 0, 1, 0, 1, 0], [0, 0.02, 0.2, 0, 0.88, 0]);
    computeLegTangents(geometry);
    expect(tangentsOf(geometry)).toEqual([0, 1, 0, 0, 0, -1]);
  });

  it("always yields unit tangents perpendicular to the normal", () => {
    const normals: number[] = [];
    for (let i = 0; i < 40; i++) {
      const theta = (i / 40) * Math.PI;
      const phi = i * 2.4;
      normals.push(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    }
    const geometry = geometryWith(normals);
    computeLegTangents(geometry);
    const t = geometry.attributes.legTangent.array;
    for (let i = 0; i < 40; i++) {
      expect(Math.hypot(t[i * 3], t[i * 3 + 1], t[i * 3 + 2])).toBeCloseTo(1, 5);
      expect(
        t[i * 3] * normals[i * 3] + t[i * 3 + 1] * normals[i * 3 + 1] + t[i * 3 + 2] * normals[i * 3 + 2],
      ).toBeCloseTo(0, 5);
    }
  });
});

describe("computeCircumference", () => {
  it("measures 2 pi r on a round tube and writes stretch relative to the reference", () => {
    const leg = tube(0.05, 0.0, 0.99, 100, 64);
    const geometry = geometryWith(new Array<number>(leg.pos.length).fill(0), [...leg.pos]);
    const circ = computeCircumference(geometry);
    expect(circ.length).toBe(100);
    for (const value of circ) {
      expect(value).toBeCloseTo(Math.PI * 0.1, 7);
    }
    const stretch = geometry.attributes.stretch.array;
    expect(stretch.length).toBe(leg.pos.length / 3);
    expect(stretch[0]).toBeCloseTo((Math.PI * 0.1) / 0.34, 6);
  });

  it("fills bins below minY and between rings from the nearest valid bin, then smooths", () => {
    const low = tube(0.05, 0.3, 0.3, 2, 32);
    const high = tube(0.1, 0.7, 0.7, 2, 32);
    const positions = [...low.pos, ...high.pos, 0, -0.5, 0];
    const geometry = geometryWith(new Array<number>(positions.length).fill(0), positions);
    const circ = computeCircumference(geometry, 0.2, 1);
    const small = 2 * Math.PI * 0.05;
    expect(circ[0]).toBeCloseTo(small, 2);
    expect(circ[50]).toBeCloseTo(small, 6);
    expect(circ[99]).toBeGreaterThan(circ[50] * 1.9);
    expect(circ[69]).toBeGreaterThan(circ[50]);
    expect(circ[69]).toBeLessThan(circ[99]);
    // The stray vertex below the floor uses bin 0.
    expect(geometry.attributes.stretch.array[positions.length / 3 - 1]).toBeCloseTo(circ[0], 6);
  });
});

describe("buildLegModel on the shipped model", () => {
  it("builds the render, low and skin geometries with the expected attributes", () => {
    const model = legModel();
    expect(Object.keys(model.stocking.attributes).sort()).toEqual([
      "legTangent",
      "normal",
      "position",
      "skinFx",
      "stretch",
      "toeShade",
      "under",
      "uv",
    ]);
    for (const name of Object.keys(model.stocking.attributes)) {
      expect(model.stockingLow.attributes[name]).toBe(model.stocking.attributes[name]);
    }
    expect(model.stockingLow.index!.array).toBe(model.collision.idx);
    expect(model.stockingLow.boundingSphere).toBe(model.stocking.boundingSphere);
    expect(model.stockingLow.boundingBox).toBe(model.stocking.boundingBox);
    expect(Object.keys(model.skin.attributes).sort()).toEqual([
      "legTangent",
      "normal",
      "position",
      "skinFx",
      "stretch",
      "toeShade",
      "under",
      "uv",
    ]);
  });

  it("gives the bare skin constant stretch, no skinFx or toe shade and an out-of-range uv", () => {
    const skin = legModel().skin;
    expect(new Set(skin.attributes.stretch.array)).toEqual(new Set([1.5]));
    expect(new Set(skin.attributes.skinFx.array)).toEqual(new Set([0]));
    expect(new Set(skin.attributes.toeShade.array)).toEqual(new Set([0]));
    expect(new Set(skin.attributes.uv.array)).toEqual(new Set([-1]));
  });

  it("produces plausible leg dimensions", () => {
    const model = legModel();
    const box = model.stocking.boundingBox!;
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(box.min.y).toBeLessThan(0.01);
    expect(box.max.y).toBeGreaterThan(0.7);
    expect(box.max.y).toBeLessThan(1);
    const circ = [...model.circumference];
    expect(Math.min(...circ)).toBeGreaterThan(0.15);
    expect(Math.max(...circ)).toBeLessThan(0.7);
    // Thicker at the thigh than at the ankle.
    expect(circ[75]).toBeGreaterThan(circ[15] * 1.5);
    const [minStretch, maxStretch] = extent(model.stocking.attributes.stretch.array);
    expect(minStretch).toBeGreaterThan(0.4);
    expect(maxStretch).toBeLessThan(2);
  });

  it("keeps normals and tangents unit length, skinFx within [-1, 1] and the toe shade at zero", () => {
    const model = legModel();
    const checks: [ArrayLike<number>, number][] = [
      [model.stocking.attributes.normal.array, 3],
      [model.stocking.attributes.legTangent.array, 3],
      [model.collision.nrm, 3],
    ];
    for (const [array] of checks) {
      for (let i = 0; i < array.length; i += 3) {
        const len = Math.hypot(array[i], array[i + 1], array[i + 2]);
        if (Math.abs(len - 1) > 1e-4) {
          throw new Error("non-unit vector at " + i / 3 + ": " + len);
        }
      }
    }
    const [minFx, maxFx] = extent(model.stocking.attributes.skinFx.array);
    expect(minFx).toBeGreaterThanOrEqual(-1);
    expect(maxFx).toBeLessThanOrEqual(1);
    expect(new Set(model.stocking.attributes.toeShade.array)).toEqual(new Set([0]));
  });

  it("pins every built array", () => {
    const model = legModel();
    expect({
      stocking: attributeDigests(model.stocking),
      skin: attributeDigests(model.skin),
      skinIndex: digest(model.skin.index!.array),
      circumference: digestRounded(model.circumference, 7),
      collision: [
        digestRounded(model.collision.pos, 6),
        digestRounded(model.collision.nrm, 6),
        digest(model.collision.uv),
        digest(model.collision.idx),
      ],
    }).toMatchInlineSnapshot(`
      {
        "circumference": "0653da83",
        "collision": [
          "1a056408",
          "bd9dc45b",
          "617bdd01",
          "1ed66ba3",
        ],
        "skin": {
          "legTangent": "712cc72e",
          "normal": "cf1f1e86",
          "position": "fc033ce3",
          "skinFx": "03a706c5",
          "stretch": "f1250325",
          "toeShade": "1ed63245",
          "under": "c30e6fc5",
          "uv": "d0b75f45",
        },
        "skinIndex": "02e47460",
        "stocking": {
          "legTangent": "1077294f",
          "normal": "27df1e3a",
          "position": "10b7badc",
          "skinFx": "686c4940",
          "stretch": "9d9226c7",
          "toeShade": "8ec92b05",
          "under": "477cb2c5",
          "uv": "736679e6",
        },
      }
    `);
  });
});

describe("buildLegModel options and sources", () => {
  let single: LegModel | undefined;
  const singleLevel = (): LegModel => (single ??= buildLegModel(modelData(), { levels: 1 }));

  it("uses the coarse mesh directly with one subdivision level", () => {
    const model = singleLevel();
    const full = legModel();
    expect(model.stocking.index!.array).toEqual(model.collision.idx);
    expect([...model.stocking.attributes.position.array]).toEqual([...model.collision.pos]);
    expect(model.collision.pos).toEqual(full.collision.pos);
    expect(topologyProblems(model.stocking.index!.array, model.collision.pos.length / 3)).toEqual([]);
  });

  it("decodes base64 wrap offsets from a JSON model the same way as binary ones", () => {
    const binary = modelData();
    const json: ModelData = {
      stocking: binary.stocking,
      skinTop: binary.skinTop,
      wrap: toBase64(binary.wrapData as Int16Array),
    };
    const fromJson = buildLegModel(json, { levels: 1 });
    expect(attributeDigests(fromJson.stocking)).toEqual(attributeDigests(singleLevel().stocking));
  });

  it("builds a model without wrap data using the default two levels", () => {
    const model = buildLegModel(tinyModelData());
    expect(new Set(model.stocking.attributes.toeShade.array)).toEqual(new Set([0]));
    const vertices = model.stocking.attributes.position.count;
    expect(vertices).toBeGreaterThan(model.collision.pos.length / 3);
    expect(topologyProblems(model.stocking.index!.array, vertices)).toEqual([]);
    // Fine triangles only near the foot: fewer than a full second subdivision.
    expect(model.stocking.index!.count).toBeGreaterThan(model.collision.idx.length);
    expect(model.stocking.index!.count).toBeLessThan(model.collision.idx.length * 4);
  });

  it("loads a .glb url as binary and any other url as JSON", async () => {
    const glb = tinyGlb();
    const json: ModelData = { ...tinyModelData(), wrap: toBase64(new Int16Array(96 * 4).fill(16)) };
    const fetchMock = vi.fn(async (url: string) => ({
      arrayBuffer: async () => glb,
      json: async () => (url.endsWith(".glb") ? null : JSON.parse(JSON.stringify(json, jsonArrays))),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fromGlb = await loadLegModel("/legs.glb", { levels: 1 });
    const fromJson = await loadLegModel("/legs.json", { levels: 1 });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/legs.glb", "/legs.json"]);
    expect(fromGlb.collision.idx).toEqual(fromJson.collision.idx);
    const source = tinyModelData().stocking.positions;
    const glbPositions = fromGlb.stocking.attributes.position.array;
    const jsonPositions = fromJson.stocking.attributes.position.array;
    // A vertex on the calf, which nothing sculpts: the foot, the knee and the thigh are shaped after loading.
    const calf = 24 * 3;
    expect(source[calf + 1]).toBeGreaterThan(0.2);
    expect(source[calf + 1]).toBeLessThan(0.4);
    expect([...glbPositions.slice(calf, calf + 3)]).toEqual(Array.from(source).slice(calf, calf + 3));
    // Wrap value 16: the vertices the wrap data covers move 0.16 mm along each axis.
    for (let c = calf; c < calf + 3; c++) {
      expect(jsonPositions[c] - glbPositions[c]).toBeCloseTo(0.00016, 7);
    }
  });
});

/** JSON.stringify replacer that writes typed arrays as plain arrays, as a JSON model file would. */
function jsonArrays(_key: string, value: unknown): unknown {
  return ArrayBuffer.isView(value) ? Array.from(value as Float32Array) : value;
}
