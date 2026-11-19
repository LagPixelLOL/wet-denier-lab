/**
 * The forefoot's skin: the foot in front of the instep, with five separate toes. The stocking mesh is one closed
 * shape stretched over the toes, so the model file carries the skin under it as a control cage (written by
 * tools/fit_toes.py from the MakeHuman base mesh). It is drawn for a bare foot, where it replaces the front of
 * the stocking mesh, and under a stocking, where it shows through the fabric.
 */
import * as THREE from "three";
import { catmullClark } from "../geometry/catmullClark";
import type { QuadMesh } from "../geometry/catmullClark";
import { buildGeometry, computeWeldedNormals, weldVertices } from "../geometry/weld";
import { SurfaceGrid } from "../surface/SurfaceGrid";
import type { SurfaceHit, SurfaceMesh } from "../surface/SurfaceGrid";
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

/**
 * The forefoot's skin as a collision mesh: positions, normals, UVs (the stocking's, see buildForefoot) and
 * triangle indices.
 */
export interface ForefootCollision {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  idx: Uint32Array;
  /** Per triangle: the triangle of the stocking's collision mesh its UVs lie around, or -1 without UVs. */
  uvTri: Int32Array;
}

/** Catmull-Clark levels of the render geometry, and of the coarser collision mesh. */
const FOREFOOT_LEVELS = 2;
const COLLISION_LEVELS = 1;

/**
 * Where the forefoot joins the leg (z and y in meters). Up to `cut` the forefoot lies exactly on the stocking
 * mesh, and from `to` on it is its own shape. The shaders draw the forefoot in front of `cut` only, and on a bare
 * leg the stocking mesh behind it only (below `maxY`: the shin is above the same z), so the two meet in one
 * line.
 */
export const FOREFOOT_JOIN = { cut: 0.112, to: 0.13, maxY: 0.09 };

/**
 * The part of a stocking geometry that reaches in front of the join (below maxY: the knee and the thigh reach
 * as far forward): the same attributes, with only the triangles there. Clipped at the join by the shaders, it
 * is the fabric the forefoot's skin shows through.
 */
export function frontOfJoin(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const positions = geometry.attributes.position.array;
  const index = geometry.index!.array;
  const kept: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const corners = [index[t], index[t + 1], index[t + 2]];
    if (
      corners.some((v) => positions[v * 3 + 2] > FOREFOOT_JOIN.cut - 0.001) &&
      corners.every((v) => positions[v * 3 + 1] < FOREFOOT_JOIN.maxY)
    ) {
      kept.push(...corners);
    }
  }
  const front = new THREE.BufferGeometry();
  for (const name of Object.keys(geometry.attributes)) {
    front.setAttribute(name, geometry.attributes[name]);
  }
  front.setIndex(new THREE.BufferAttribute(new Uint32Array(kept), 1));
  front.boundingSphere = geometry.boundingSphere;
  front.boundingBox = geometry.boundingBox;
  return front;
}

/** The cage reaches further back than the join; the render geometry keeps this much of it behind the cut. */
const BEHIND_CUT = 0.004;

/**
 * How many times faster than on the collision mesh under them the borrowed UVs may change along an edge of the
 * skin. Beyond that the two ends lie on two sides of a seam of the stocking's UVs, or under two far apart places
 * of it (deep between two toes, the nearest stocking is above one vertex and below the next).
 */
const SEAM_STRETCH = 3;

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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
 * The closest point of `surface` within `reach`, like surface.closest(). It looks nearby first, since a wide
 * search visits every cell in reach and most points are close.
 */
function closestWithin(surface: SurfaceGrid, x: number, y: number, z: number, reach: number): SurfaceHit | null {
  for (let near = reach / 8; near < reach; near *= 2) {
    const hit = surface.closest(x, y, z, near);
    if (hit) {
      return hit;
    }
  }
  return surface.closest(x, y, z, reach);
}

/** The subdivided skin before it becomes a geometry: per-vertex arrays and triangles. */
interface Skin {
  positions: Float32Array;
  uvs: Float32Array;
  shade: Float32Array;
  /** Per vertex: how much it follows the stocking's surface (1 behind the join), and that surface's normal. */
  onStocking: Float32Array;
  stockingNormals: Float32Array;
  triangles: Uint32Array;
  /** Per triangle: the collision triangle its UVs lie around (see ForefootCollision.uvTri). */
  uvTri: Int32Array;
}

/**
 * Subdivides the cage `levels` times, lays its back onto `stocking`, borrows the UVs of `collision` and keeps
 * the quads that reach in front of the cut, or to within `behind` of it.
 */
function buildSkin(
  data: ForefootData,
  stocking: SurfaceMesh,
  collision: SurfaceMesh,
  levels: number,
  behind: number,
): Skin {
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
  for (let level = 0; level < levels; level++) {
    mesh = catmullClark(mesh);
  }
  const count = mesh.values.length / 4;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2).fill(-1);
  const shade = new Float32Array(count);
  const onStocking = new Float32Array(count);
  const stockingNormals = new Float32Array(count * 3);
  // Per vertex: the collision triangle its UV was found on, and how far away.
  const uvTris = new Int32Array(count).fill(-1);
  const uvDists = new Float32Array(count);
  const surface = new SurfaceGrid(collision);
  const join = joinSurface(stocking);
  for (let i = 0; i < count; i++) {
    let x = mesh.values[i * 4];
    let y = mesh.values[i * 4 + 1];
    let z = mesh.values[i * 4 + 2];
    shade[i] = mesh.values[i * 4 + 3];
    const uvHit = closestWithin(surface, x, y, z, 0.03);
    if (uvHit) {
      uvs[i * 2] = uvHit.u;
      uvs[i * 2 + 1] = uvHit.v;
      uvTris[i] = uvHit.tri;
      uvDists[i] = uvHit.dist;
    }
    const follow = 1 - smoothstep(FOREFOOT_JOIN.cut + 0.001, FOREFOOT_JOIN.to, z);
    const hit = follow > 0 ? closestWithin(join, x, y, z, 0.01) : null;
    if (hit) {
      onStocking[i] = follow;
      stockingNormals.set([hit.nx, hit.ny, hit.nz], i * 3);
      x += (hit.x - x) * follow;
      y += (hit.y - y) * follow;
      z += (hit.z - z) * follow;
    }
    positions.set([x, y, z], i * 3);
  }
  const kept: number[] = [];
  for (let q = 0; q < mesh.quads.length / 4; q++) {
    const [a, b, c, d] = mesh.quads.subarray(q * 4, q * 4 + 4);
    if ([a, b, c, d].some((v) => positions[v * 3 + 2] > FOREFOOT_JOIN.cut - behind)) {
      kept.push(a, b, c, a, c, d);
    }
  }
  const triangles = new Uint32Array(kept);
  // Triangles that span a seam of the borrowed UVs get corners of their own, with UVs on one side of it.
  const { sources, seamUvs, uvTri } = splitUvSeams(positions, uvs, triangles, collision, surface.triIsland, {
    tris: uvTris,
    dists: uvDists,
  });
  const extra = sources.length;
  if (!extra) {
    return { positions, uvs, shade, onStocking, stockingNormals, triangles, uvTri };
  }
  const grown = (array: Float32Array, size: number): Float32Array => {
    const out = new Float32Array((count + extra) * size);
    out.set(array);
    sources.forEach((source, i) => out.set(array.subarray(source * size, (source + 1) * size), (count + i) * size));
    return out;
  };
  const allUvs = grown(uvs, 2);
  allUvs.set(seamUvs, count * 2);
  return {
    positions: grown(positions, 3),
    uvs: allUvs,
    shade: grown(shade, 1),
    onStocking: grown(onStocking, 1),
    stockingNormals: grown(stockingNormals, 3),
    triangles,
    uvTri,
  };
}

/**
 * Finds the triangles whose corners took their UVs from places of `collision` that do not belong together: on
 * two UV islands, or much further apart in UV than the skin between them is long (SEAM_STRETCH). Such a
 * triangle goes by its corner nearest to the collision mesh: the corners that are apart from that one get their
 * UVs by continuing its collision triangle to them (their positions in that triangle's plane give the UVs). A
 * corner that needs another UV than its vertex has becomes a new vertex, like at a UV seam of any mesh:
 * `triangles` is rewritten to use it, `sources` lists the vertex each new one copies and `seamUvs` its UV.
 * `hits` has, per vertex, the collision triangle its UV came from (-1 for none) and its distance to it.
 */
function splitUvSeams(
  positions: Float32Array,
  uvs: Float32Array,
  triangles: Uint32Array,
  collision: SurfaceMesh,
  islands: ArrayLike<number>,
  hits: { tris: Int32Array; dists: Float32Array },
): { sources: number[]; seamUvs: number[]; uvTri: Int32Array } {
  const count = positions.length / 3;
  const collisionTris = collision.idx.length / 3;
  const sources: number[] = [];
  const seamUvs: number[] = [];
  const uvTri = new Int32Array(triangles.length / 3);
  // New vertices by the vertex they copy and the collision triangle their UV continues.
  const copies = new Map<number, number>();
  // Per collision triangle: how fast its UVs change, in UV units per meter along its steepest edge.
  const uvRates = new Float32Array(collisionTris).fill(-1);
  const uvRate = (tri: number): number => {
    if (uvRates[tri] < 0) {
      for (let k = 0; k < 3; k++) {
        const a = collision.idx[tri * 3 + k];
        const b = collision.idx[tri * 3 + ((k + 1) % 3)];
        const length = Math.hypot(
          collision.pos[a * 3] - collision.pos[b * 3],
          collision.pos[a * 3 + 1] - collision.pos[b * 3 + 1],
          collision.pos[a * 3 + 2] - collision.pos[b * 3 + 2],
        );
        const change = Math.max(
          Math.abs(collision.uv[a * 2] - collision.uv[b * 2]),
          Math.abs(collision.uv[a * 2 + 1] - collision.uv[b * 2 + 1]),
        );
        uvRates[tri] = Math.max(uvRates[tri], length > 0 ? change / length : 0);
      }
    }
    return uvRates[tri];
  };
  const apart = (a: number, b: number): boolean => {
    if (islands[hits.tris[a]] !== islands[hits.tris[b]]) {
      return true;
    }
    const reach =
      SEAM_STRETCH *
      Math.max(uvRate(hits.tris[a]), uvRate(hits.tris[b])) *
      Math.hypot(
        positions[a * 3] - positions[b * 3],
        positions[a * 3 + 1] - positions[b * 3 + 1],
        positions[a * 3 + 2] - positions[b * 3 + 2],
      );
    return Math.abs(uvs[a * 2] - uvs[b * 2]) > reach || Math.abs(uvs[a * 2 + 1] - uvs[b * 2 + 1]) > reach;
  };
  for (let t = 0; t < triangles.length; t += 3) {
    const corners = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const found = corners.filter((v) => hits.tris[v] >= 0);
    if (found.length < 3) {
      uvTri[t / 3] = found.length ? hits.tris[found[0]] : -1;
      continue;
    }
    let anchor = corners[0];
    for (const v of corners) {
      if (hits.dists[v] < hits.dists[anchor]) {
        anchor = v;
      }
    }
    const tri = (uvTri[t / 3] = hits.tris[anchor]);
    if (!apart(corners[0], corners[1]) && !apart(corners[1], corners[2]) && !apart(corners[2], corners[0])) {
      continue;
    }
    // The corners on the anchor's side keep their UVs, unless it is those two that are apart.
    const others = corners.filter((v) => v !== anchor);
    const across = others.filter((v) => apart(anchor, v));
    const moved = across.length ? across : others;
    const [a, b, c] = [collision.idx[tri * 3], collision.idx[tri * 3 + 1], collision.idx[tri * 3 + 2]];
    const edge = (from: number, to: number): number[] =>
      [0, 1, 2].map((k) => collision.pos[to * 3 + k] - collision.pos[from * 3 + k]);
    const ab = edge(a, b);
    const ac = edge(a, c);
    const d00 = dot(ab, ab);
    const d01 = dot(ab, ac);
    const d11 = dot(ac, ac);
    const det = d00 * d11 - d01 * d01;
    for (let k = 0; k < 3; k++) {
      const v = corners[k];
      if (!moved.includes(v) || hits.tris[v] === tri || det <= 0) {
        continue;
      }
      const key = v * collisionTris + tri;
      let copy = copies.get(key);
      if (copy === undefined) {
        copy = count + sources.length;
        copies.set(key, copy);
        sources.push(v);
        // Barycentric coordinates of the vertex in the plane of the collision triangle, inside it or not.
        const ap = [0, 1, 2].map((axis) => positions[v * 3 + axis] - collision.pos[a * 3 + axis]);
        const d20 = dot(ap, ab);
        const d21 = dot(ap, ac);
        const wb = (d11 * d20 - d01 * d21) / det;
        const wc = (d00 * d21 - d01 * d20) / det;
        const wa = 1 - wb - wc;
        seamUvs.push(
          wa * collision.uv[a * 2] + wb * collision.uv[b * 2] + wc * collision.uv[c * 2],
          wa * collision.uv[a * 2 + 1] + wb * collision.uv[b * 2 + 1] + wc * collision.uv[c * 2 + 1],
        );
      }
      triangles[t + k] = copy;
    }
  }
  return { sources, seamUvs, uvTri };
}

/**
 * How the skin lies under a stocking (m). The fabric is fitted to the skin in the model file (tools/fit_toes.py),
 * so the skin keeps the shape it has bare: it only moves where the fabric would otherwise touch it or come
 * through, to `margin` under the fabric's surface. `tight` and `loose` are the range of distances under the
 * fabric over which that fades out, for skin that faces the fabric (`facing`, the range of the cosine between
 * the two normals; the wall of a toe beside fabric that bridges the cleft is left alone), `toes` the same for
 * the toes. The move is evened out over `broad`, up to `local` of each vertex's own. Skin that ends up less
 * than `worn` under the fabric counts as wearing it, in full `edge` away from skin that does not.
 */
export const UNDER_FIT = {
  margin: 0.0001,
  worn: 0.0006,
  edge: 0.003,
  broad: 0.002,
  local: 0.0003,
  toes: { tight: 0.0001, beside: 0.004, behind: 0.008, crease: 0.007 },
  tight: 0.0001,
  loose: 0.00015,
  facing: [0.45, 0.75],
};

/** The triangles of `mesh` that the forefoot's skin can lie under. */
function fabricOverForefoot(mesh: SurfaceMesh): SurfaceGrid {
  const kept: number[] = [];
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const corners = [mesh.idx[t], mesh.idx[t + 1], mesh.idx[t + 2]];
    if (
      corners.every((v) => mesh.pos[v * 3 + 1] < FOREFOOT_JOIN.maxY + 0.02) &&
      corners.some((v) => mesh.pos[v * 3 + 2] > FOREFOOT_JOIN.cut - 0.01)
    ) {
      kept.push(...corners);
    }
  }
  return new SurfaceGrid({ ...mesh, idx: new Uint32Array(kept) }, 0.003);
}

/**
 * Per vertex of the skin, for drawing it under `stocking`: the offset that fits it to the fabric (xyz, in the
 * rest pose) and how much it is covered by fabric lying on it (w, 0 to 1), see UNDER_FIT. No vertex is left
 * nearer than the margin to the fabric's surface, or outside it, so the fabric always covers the skin.
 */
function fitUnderStocking(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  shade: ArrayLike<number>,
  triangles: ArrayLike<number>,
  stocking: SurfaceMesh,
): Float32Array {
  const count = positions.length / 3;
  const under = new Float32Array(count * 4);
  const fabric = fabricOverForefoot(stocking);
  const { margin, tight, loose, facing, toes } = UNDER_FIT;
  const weld = weldVertices(positions);
  // Vertices by cell of a grid, to find the ones near a point.
  const bucketsOf = (size: number, keep: (i: number) => boolean) => {
    const cellAt = (x: number, y: number, z: number): string =>
      `${Math.floor(x / size)},${Math.floor(y / size)},${Math.floor(z / size)}`;
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < count; i++) {
      if (weld[i] === i && keep(i)) {
        const key = cellAt(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.push(i);
        } else {
          buckets.set(key, [i]);
        }
      }
    }
    /** Calls `visit` with every kept vertex within `size` of the point (and some a little further), and its squared distance. */
    return (x: number, y: number, z: number, visit: (other: number, apart: number) => void): void => {
      for (let c = 0; c < 27; c++) {
        const bucket = buckets.get(
          cellAt(x + ((c % 3) - 1) * size, y + ((((c / 3) | 0) % 3) - 1) * size, z + (((c / 9) | 0) - 1) * size),
        );
        for (const other of bucket ?? []) {
          visit(
            other,
            (positions[other * 3] - x) ** 2 + (positions[other * 3 + 1] - y) ** 2 + (positions[other * 3 + 2] - z) ** 2,
          );
        }
      }
    };
  };
  // How much each vertex belongs to a toe: 1 from where the cleft beside it begins (the rearmost skin between
  // two toes, among that within `toes.beside` of the nearest across the foot) forward, fading out over
  // `toes.behind` behind that.
  const clefts: number[] = [];
  for (let i = 0; i < count; i++) {
    if (weld[i] === i && shade[i] > 0.2) {
      clefts.push(i);
    }
  }
  const onToe = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (weld[i] !== i) {
      continue;
    }
    let beside = Infinity;
    for (const cleft of clefts) {
      beside = Math.min(beside, Math.abs(positions[cleft * 3] - positions[i * 3]));
    }
    let begin = Infinity;
    for (const cleft of clefts) {
      if (Math.abs(positions[cleft * 3] - positions[i * 3]) < beside + toes.beside) {
        begin = Math.min(begin, positions[cleft * 3 + 2]);
      }
    }
    // Under the foot the crease behind the toes' pads belongs to them too.
    begin -= toes.crease * smoothstep(-0.2, 0.3, -normals[i * 3 + 1]);
    onToe[i] = begin < Infinity ? smoothstep(begin - toes.behind, begin, positions[i * 3 + 2]) : 0;
  }
  // Where each vertex would go to lie against the fabric, and how much it is pressed that way.
  const wanted = new Float32Array(count * 3);
  const pressed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (weld[i] !== i) {
      continue;
    }
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const hit = closestWithin(fabric, x, y, z, loose);
    if (!hit) {
      continue;
    }
    // How far under the fabric the skin lies; negative where it sticks out.
    const clearance = -hit.side * hit.dist;
    const faces = normals[i * 3] * hit.nx + normals[i * 3 + 1] * hit.ny + normals[i * 3 + 2] * hit.nz;
    // Deep in a cleft the nearest fabric can be the far side of a fold, which the skin is not under at all.
    // A toe keeps its own shape: it only meets fabric that is nearly on it already.
    const scale = 1 + (toes.tight / tight - 1) * onToe[i];
    pressed[i] =
      clearance <= margin
        ? faces > facing[0] && clearance > -0.001
          ? 1
          : 0
        : (1 - smoothstep(tight * scale, loose * scale, clearance)) * smoothstep(facing[0], facing[1], faces);
    wanted.set([hit.x - hit.nx * margin - x, hit.y - hit.ny * margin - y, hit.z - hit.nz * margin - z], i * 3);
  }
  // The skin keeps its shape: it follows the broad part of that move (the mean over the skin around it, which
  // also carries the walls of a toe along with its top), and only up to `local` of what is left of its own.
  const { broad, local } = UNDER_FIT;
  const reach = broad * 2;
  const around = bucketsOf(reach, () => true);
  const offsets = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    if (weld[i] !== i) {
      continue;
    }
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let total = 0;
    around(x, y, z, (other, apart) => {
      if (apart <= reach * reach) {
        const share = Math.exp(-apart / (2 * broad * broad));
        total += share;
        sx += share * pressed[other] * wanted[other * 3];
        sy += share * pressed[other] * wanted[other * 3 + 1];
        sz += share * pressed[other] * wanted[other * 3 + 2];
      }
    });
    sx /= total;
    sy /= total;
    sz /= total;
    const rx = wanted[i * 3] - sx;
    const ry = wanted[i * 3 + 1] - sy;
    const rz = wanted[i * 3 + 2] - sz;
    const own = pressed[i] * Math.min(1, local / (Math.hypot(rx, ry, rz) || 1));
    offsets.set([sx + rx * own, sy + ry * own, sz + rz * own], i * 3);
  }
  let worn: Float32Array = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (weld[i] !== i) {
      continue;
    }
    let dx = offsets[i * 3];
    let dy = offsets[i * 3 + 1];
    let dz = offsets[i * 3 + 2];
    // Wherever that leaves the skin too close to the fabric, or outside it, it goes back under it.
    const near = fabric.closest(positions[i * 3] + dx, positions[i * 3 + 1] + dy, positions[i * 3 + 2] + dz, 0.001);
    if (near) {
      const faces = normals[i * 3] * near.nx + normals[i * 3 + 1] * near.ny + normals[i * 3 + 2] * near.nz;
      let gap = -near.side * near.dist;
      if (gap < margin && faces > facing[0]) {
        dx -= near.nx * (margin - gap);
        dy -= near.ny * (margin - gap);
        dz -= near.nz * (margin - gap);
        gap = margin;
      }
      // The skin wears the fabric where the two end up touching, and it faced the fabric well enough to be
      // pressed against it: near the wall of a toe the fabric can pass as close, but that skin is seen from
      // between the toes, under the fabric.
      worn[i] = (1 - smoothstep(1.3 * margin, UNDER_FIT.worn, gap)) * smoothstep(facing[0], facing[1], faces);
    }
    under.set([dx, dy, dz], i * 4);
  }
  // The other way round: where the skin curves in, a vertex of the fabric can still reach the flat triangle
  // between the skin's vertices, although those are under the fabric. Such a triangle sinks until it is not.
  const fitted = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) {
    fitted[i] = positions[i] + under[weld[(i / 3) | 0] * 4 + (i % 3)];
  }
  const skinSurface = new SurfaceGrid(
    { pos: fitted, nrm: normals, uv: new Float32Array(count * 2), idx: triangles },
    0.003,
  );
  const sink = new Float32Array(count);
  const checked = new Uint8Array(stocking.pos.length / 3);
  for (let at = 0; at < fabric.idx.length; at++) {
    const f = fabric.idx[at];
    if (checked[f]) {
      continue;
    }
    checked[f] = 1;
    const hit = skinSurface.closest(stocking.pos[f * 3], stocking.pos[f * 3 + 1], stocking.pos[f * 3 + 2], 0.0006);
    if (
      !hit ||
      stocking.nrm[f * 3] * hit.nx + stocking.nrm[f * 3 + 1] * hit.ny + stocking.nrm[f * 3 + 2] * hit.nz < facing[0]
    ) {
      continue;
    }
    const short = margin * 0.6 - hit.side * hit.dist;
    if (short > 0) {
      for (let k = 0; k < 3; k++) {
        const v = weld[triangles[hit.tri * 3 + k]];
        sink[v] = Math.max(sink[v], short);
      }
    }
  }
  for (let i = 0; i < count; i++) {
    if (sink[i] > 0) {
      for (let k = 0; k < 3; k++) {
        under[i * 4 + k] -= normals[i * 3 + k] * sink[i];
      }
    }
  }
  // Skin counts as worn only well inside a patch of it: along the patch's edge the fabric lifts off, and the
  // skin there is also seen from under the lifted fabric, bare. So it is worn in full only `edge` away from any
  // skin that is not, and less the nearer it is to such skin. Behind the join the skin is the stocking's own,
  // so the join is no such edge.
  const { edge } = UNDER_FIT;
  for (let i = 0; i < count; i++) {
    if (positions[i * 3 + 2] < FOREFOOT_JOIN.cut) {
      worn[i] = 1;
    }
  }
  // Nor is a vertex worn unless its neighbours touch the fabric too: across a triangle between a vertex that
  // does and one that does not, the fabric is already well off the skin.
  const raw = worn.slice();
  for (let t = 0; t < triangles.length; t += 3) {
    const corners = [weld[triangles[t]], weld[triangles[t + 1]], weld[triangles[t + 2]]];
    const least = Math.min(worn[corners[0]], worn[corners[1]], worn[corners[2]]);
    for (const v of corners) {
      raw[v] = Math.min(raw[v], least);
    }
  }
  const nearBare = bucketsOf(edge, (i) => raw[i] < 1);
  worn = raw.slice();
  for (let i = 0; i < count; i++) {
    if (weld[i] === i && raw[i] > 0) {
      nearBare(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], (other, apart) => {
        worn[i] = Math.min(worn[i], raw[other] + Math.sqrt(apart) / edge);
      });
    }
  }
  for (let i = 0; i < count; i++) {
    under[i * 4 + 3] = worn[i];
    if (weld[i] !== i) {
      under.copyWithin(i * 4, weld[i] * 4, weld[i] * 4 + 4);
    }
  }
  return under;
}

/** Across the join the skin is lit like the stocking mesh it continues, so no seam shows. */
function blendToStockingNormals(normals: THREE.TypedArray, skin: Skin): void {
  for (let i = 0; i < skin.onStocking.length; i++) {
    const n = [0, 1, 2].map(
      (k) => normals[i * 3 + k] + (skin.stockingNormals[i * 3 + k] - normals[i * 3 + k]) * skin.onStocking[i],
    );
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    normals.set([n[0] / length, n[1] / length, n[2] / length], i * 3);
  }
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
  const skin = buildSkin(data, stocking, collision, FOREFOOT_LEVELS, BEHIND_CUT);
  const { positions } = skin;
  const count = positions.length / 3;
  // Vertices are welded by position for the normals, so the copies at UV seams are lit like their originals.
  const geometry = buildGeometry(positions, skin.uvs, skin.triangles);
  const normals = geometry.attributes.normal.array;
  blendToStockingNormals(normals, skin);
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
  geometry.setAttribute("toeShade", new THREE.BufferAttribute(skin.shade, 1));
  geometry.setAttribute(
    "under",
    new THREE.BufferAttribute(fitUnderStocking(positions, normals, skin.shade, skin.triangles, stocking), 4),
  );
  return geometry;
}

/**
 * Builds the forefoot's skin for collision: the same surface as buildForefoot (same arguments), one subdivision
 * level coarser, from the cut forward, with only the vertices its triangles use.
 */
export function buildForefootCollision(
  data: ForefootData,
  stocking: SurfaceMesh,
  collision: SurfaceMesh,
): ForefootCollision {
  const skin = buildSkin(data, stocking, collision, COLLISION_LEVELS, 0);
  const normals = computeWeldedNormals(skin.positions, skin.triangles, weldVertices(skin.positions));
  blendToStockingNormals(normals, skin);
  const used = new Int32Array(skin.positions.length / 3).fill(-1);
  let count = 0;
  const idx = skin.triangles.map((v) => (used[v] < 0 ? (used[v] = count++) : used[v]));
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  used.forEach((to, from) => {
    if (to >= 0) {
      pos.set(skin.positions.subarray(from * 3, from * 3 + 3), to * 3);
      nrm.set(normals.subarray(from * 3, from * 3 + 3), to * 3);
      uv.set(skin.uvs.subarray(from * 2, from * 2 + 2), to * 2);
    }
  });
  return { pos, nrm, uv, idx, uvTri: skin.uvTri };
}
