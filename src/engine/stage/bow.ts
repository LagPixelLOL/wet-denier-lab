/**
 * The ribbon bow mesh and where it sits on the cuff.
 */
import * as THREE from "three";
import type { CollisionMesh } from "../model/legModel";
import type { Vec3 } from "../rig/joints";

interface PatchMesh {
  pos: number[];
  idx: number[];
  /** [first vertex, row stride, rows] of patches whose first and last columns coincide. */
  seams: [number, number, number][];
}

function addPatch(
  mesh: PatchMesh,
  segU: number,
  segV: number,
  surfaceFn: (u: number, v: number) => Vec3,
  closedSeam = false,
): void {
  const base = mesh.pos.length / 3;
  for (let row = 0; row <= segV; row++) {
    for (let col = 0; col <= segU; col++) {
      mesh.pos.push(...surfaceFn(col / segU, row / segV));
    }
  }
  const rowStride = segU + 1;
  for (let row = 0; row < segV; row++) {
    for (let col = 0; col < segU; col++) {
      const i00 = base + row * rowStride + col;
      const i10 = i00 + 1;
      const i01 = i00 + rowStride;
      const i11 = i01 + 1;
      mesh.idx.push(i00, i10, i11, i00, i11, i01);
    }
  }
  if (closedSeam) {
    mesh.seams.push([base, rowStride, segV]);
  }
}

export function createBowGeometry(): THREE.BufferGeometry {
  const mesh: PatchMesh = {
    pos: [],
    idx: [],
    seams: [],
  };
  const loopWidth = 0.021;
  const loopHeight = 0.017;
  const loopThickness = 0.0042;
  for (const side of [1, -1]) {
    const loopEdge = (t: number): [number, number] => [
      side * loopWidth * Math.sin(Math.PI * t),
      loopHeight * 0.5 * Math.sin(Math.PI * 2 * t) * (0.75 + Math.sin(Math.PI * t) * 0.25),
    ];
    const knotX = side * loopWidth * 0.56;
    const knotY = 0;
    addPatch(mesh, 28, 6, (u, v) => {
      const edge = loopEdge(u);
      const s = 1 - v;
      const x = knotX + (edge[0] - knotX) * s;
      const y = knotY + (edge[1] - knotY) * s;
      const taper = 0.35 + Math.min(1, Math.abs(x) / (loopWidth * 0.5)) * 0.65;
      const z =
        0.0008 +
        loopThickness * taper * Math.sqrt(1 - s * s) * (1 - Math.exp(-((y / (loopHeight * 0.12)) ** 2)) * 0.22);
      return [x, y, z];
    });
  }
  for (const side of [1, -1]) {
    addPatch(mesh, 4, 6, (u, v) => {
      const spread = side * 0.34;
      const notch = v > 0.86 ? ((v - 0.86) / 0.14) * 0.0045 * (1 - Math.abs(u * 2 - 1)) : 0;
      const y = -(v * 0.026) + notch;
      const x = side * 0.0022 + spread * v * 0.026 + (u - 0.5) * 0.0075 * (0.8 + v * 0.3);
      const z = 0.0012 + Math.sin(Math.PI * u) * 0.0016 * (1 - v * 0.4) + Math.sin(v * 5) * 0.0012;
      return [x, y, z];
    });
  }
  addPatch(
    mesh,
    12,
    6,
    (u, v) => {
      const theta = u * Math.PI * 2;
      const phi = v * Math.PI * 0.5;
      return [
        Math.cos(theta) * 0.0042 * Math.cos(phi),
        Math.sin(theta) * 0.0052 * Math.cos(phi),
        0.0012 + Math.sin(phi) * 0.0046,
      ];
    },
    true,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.pos), 3));
  geometry.setIndex(mesh.idx);
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal.array;
  for (const [start, stride, rows] of mesh.seams) {
    for (let row = 0; row <= rows; row++) {
      const firstIdx = (start + row * stride) * 3;
      const lastIdx = (start + row * stride + stride - 1) * 3;
      for (let k = 0; k < 3; k++) {
        const avg = (normals[firstIdx + k] + normals[lastIdx + k]) / 2;
        normals[firstIdx + k] = normals[lastIdx + k] = avg;
      }
    }
  }
  return geometry;
}

/** Column-major matrix placing the bow on the outer side of the cuff at `cuffY`. */
export function computeBowMatrix(
  collision: Pick<CollisionMesh, "pos" | "nrm">,
  cuffY: number,
  out: Float64Array = new Float64Array(16),
): Float64Array {
  const pos = collision.pos;
  const nrm = collision.nrm;
  const vertexCount = pos.length / 3;
  const ringY = cuffY - 0.016;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    if (Math.abs(pos[i * 3 + 1] - ringY) < 0.006) {
      minX = Math.min(minX, pos[i * 3]);
      maxX = Math.max(maxX, pos[i * 3]);
      minZ = Math.min(minZ, pos[i * 3 + 2]);
      maxZ = Math.max(maxZ, pos[i * 3 + 2]);
    }
  }
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const targetAngle = 0.87;
  let bestIndex = -1;
  let bestScore = Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const dy = Math.abs(pos[i * 3 + 1] - ringY);
    if (dy > 0.006) {
      continue;
    }
    const score = Math.abs(Math.atan2(pos[i * 3] - centerX, pos[i * 3 + 2] - centerZ) - targetAngle) + dy * 20;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  const anchor = [pos[bestIndex * 3], ringY, pos[bestIndex * 3 + 2]];
  const normal = [nrm[bestIndex * 3], nrm[bestIndex * 3 + 1], nrm[bestIndex * 3 + 2]];
  let tangent = [normal[2], 0, -normal[0]];
  const len = Math.hypot(tangent[0], tangent[2]) || 1;
  tangent = [tangent[0] / len, 0, tangent[2] / len];
  const bitangent = [
    normal[1] * tangent[2] - normal[2] * tangent[1],
    normal[2] * tangent[0] - normal[0] * tangent[2],
    normal[0] * tangent[1] - normal[1] * tangent[0],
  ];
  out.set([
    tangent[0],
    tangent[1],
    tangent[2],
    0,
    bitangent[0],
    bitangent[1],
    bitangent[2],
    0,
    normal[0],
    normal[1],
    normal[2],
    0,
    anchor[0] + normal[0] * 0.0004,
    anchor[1] + normal[1] * 0.0004,
    anchor[2] + normal[2] * 0.0004,
    1,
  ]);
  return out;
}
