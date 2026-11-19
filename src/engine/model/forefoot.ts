/**
 * The forefoot's skin: the foot in front of the instep, with five separate toes. The stocking mesh is one closed
 * shape stretched over the toes, so the model file carries the skin under it as a control cage (written by
 * tools/fit_toes.py from the MakeHuman base mesh). It is drawn for a bare foot, where it replaces the front of
 * the stocking mesh, and under a stocking, where it shows through the fabric.
 */
import * as THREE from "three";
import { catmullClark } from "../geometry/catmullClark";
import type { QuadMesh } from "../geometry/catmullClark";
import { buildGeometry } from "../geometry/weld";
import { SurfaceGrid } from "../surface/SurfaceGrid";
import type { SurfaceMesh } from "../surface/SurfaceGrid";
import { bonyAt } from "./anatomy";
import { computeLegTangents, stretchAt } from "./tangents";

/** A toenail as a frame on the skin, in meters. */
export interface ToeNail {
  center: readonly number[];
  normal: readonly number[];
  /** Toward the toe's tip, in the nail's plane. */
  forward: readonly number[];
  /** Half the nail's width and length. */
  half: readonly number[];
}

/** The forefoot as stored in the model file. */
export interface ForefootData {
  /** Control cage for Catmull-Clark subdivision. */
  positions: ArrayLike<number>;
  /** Per cage vertex: how deep it lies between two toes, 0 to 255. */
  shade: ArrayLike<number>;
  /** Two triangles per quad: a b c, a c d. */
  indices: ArrayLike<number>;
  /** The toenails, big toe first. */
  nails?: ToeNail[];
}

const FOREFOOT_LEVELS = 2;

/**
 * Where the forefoot joins the leg (z and y in meters). Up to `cut` the forefoot lies exactly on the stocking
 * mesh, and from `to` on it is its own shape. The shaders draw the forefoot in front of `cut` only, and on a bare
 * leg the stocking mesh behind it only (below `maxY`: the shin is above the same z), so the two meet in one
 * line.
 */
export const FOREFOOT_JOIN = { cut: 0.112, to: 0.13, maxY: 0.09 };

/** The cage reaches further back than the join; the geometry keeps this much of it behind the cut. */
const BEHIND_CUT = 0.004;

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** The triangles of `mesh` around the join, which the back of the forefoot is laid onto. */
function joinSurface(mesh: SurfaceMesh): SurfaceGrid {
  const kept: number[] = [];
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const corners = [mesh.idx[t], mesh.idx[t + 1], mesh.idx[t + 2]];
    if (
      corners.every((v) => mesh.pos[v * 3 + 1] < FOREFOOT_JOIN.maxY + 0.02) &&
      corners.some((v) => mesh.pos[v * 3 + 2] > FOREFOOT_JOIN.cut - 0.03) &&
      corners.some((v) => mesh.pos[v * 3 + 2] < FOREFOOT_JOIN.to + 0.01)
    ) {
      kept.push(...corners);
    }
  }
  return new SurfaceGrid({ ...mesh, idx: new Uint32Array(kept) }, 0.004);
}

/**
 * Builds the forefoot's render geometry, with the attributes the leg shader reads.
 * `stocking` is the stocking's render mesh, which the back of the forefoot is laid onto; `collision` its
 * collision mesh, whose UVs (the wet map's) the skin borrows; `circumference` the leg's, for the stretch
 * attribute.
 */
export function buildForefoot(
  data: ForefootData,
  stocking: SurfaceMesh,
  collision: SurfaceMesh,
  circumference: ArrayLike<number>,
): THREE.BufferGeometry {
  const cageCount = data.positions.length / 3;
  const values = new Float32Array(cageCount * 4);
  for (let i = 0; i < cageCount; i++) {
    values.set(
      [data.positions[i * 3], data.positions[i * 3 + 1], data.positions[i * 3 + 2], data.shade[i] / 255],
      i * 4,
    );
  }
  const quadCount = data.indices.length / 6;
  const quads = new Uint32Array(quadCount * 4);
  for (let q = 0; q < quadCount; q++) {
    quads.set([data.indices[q * 6], data.indices[q * 6 + 1], data.indices[q * 6 + 2], data.indices[q * 6 + 5]], q * 4);
  }
  let mesh: QuadMesh = { values, stride: 4, quads };
  for (let level = 0; level < FOREFOOT_LEVELS; level++) {
    mesh = catmullClark(mesh);
  }
  const count = mesh.values.length / 4;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2).fill(-1);
  const shade = new Float32Array(count);
  // Per vertex: how much it follows the stocking's surface (1 behind the join), and that surface's normal.
  const onStocking = new Float32Array(count);
  const stockingNormals = new Float32Array(count * 3);
  const surface = new SurfaceGrid(collision);
  const join = joinSurface(stocking);
  for (let i = 0; i < count; i++) {
    let x = mesh.values[i * 4];
    let y = mesh.values[i * 4 + 1];
    let z = mesh.values[i * 4 + 2];
    shade[i] = mesh.values[i * 4 + 3];
    const uvHit = surface.closest(x, y, z, 0.03);
    if (uvHit) {
      uvs[i * 2] = uvHit.u;
      uvs[i * 2 + 1] = uvHit.v;
    }
    const follow = 1 - smoothstep(FOREFOOT_JOIN.cut + 0.001, FOREFOOT_JOIN.to, z);
    const hit = follow > 0 ? join.closest(x, y, z, 0.01) : null;
    if (hit) {
      onStocking[i] = follow;
      stockingNormals.set([hit.nx, hit.ny, hit.nz], i * 3);
      x += (hit.x - x) * follow;
      y += (hit.y - y) * follow;
      z += (hit.z - z) * follow;
    }
    positions.set([x, y, z], i * 3);
  }
  const triangles: number[] = [];
  for (let q = 0; q < mesh.quads.length / 4; q++) {
    const [a, b, c, d] = mesh.quads.subarray(q * 4, q * 4 + 4);
    if ([a, b, c, d].some((v) => positions[v * 3 + 2] > FOREFOOT_JOIN.cut - BEHIND_CUT)) {
      triangles.push(a, b, c, a, c, d);
    }
  }
  const geometry = buildGeometry(positions, uvs, new Uint32Array(triangles));
  const normals = geometry.attributes.normal.array;
  // Across the join the skin is lit like the stocking mesh it continues, so no seam shows.
  for (let i = 0; i < count; i++) {
    const n = [0, 1, 2].map(
      (k) => normals[i * 3 + k] + (stockingNormals[i * 3 + k] - normals[i * 3 + k]) * onStocking[i],
    );
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    normals.set([n[0] / length, n[1] / length, n[2] / length], i * 3);
  }
  computeLegTangents(geometry);
  const stretch = new Float32Array(count);
  const skinFx = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    stretch[i] = stretchAt(circumference, positions[i * 3 + 1]);
    skinFx[i * 2 + 1] = bonyAt(
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
      normals[i * 3],
      normals[i * 3 + 1],
      normals[i * 3 + 2],
    );
  }
  geometry.setAttribute("stretch", new THREE.BufferAttribute(stretch, 1));
  geometry.setAttribute("skinFx", new THREE.BufferAttribute(skinFx, 2));
  geometry.setAttribute("toeShade", new THREE.BufferAttribute(shade, 1));
  return geometry;
}
