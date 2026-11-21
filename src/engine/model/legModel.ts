/**
 * Loads the leg model and builds the render, collision and stretch data used by the rest of the engine.
 */
import * as THREE from "three";
import { STOCKING_LENGTHS } from "../catalog/garments";
import type { StockingLengthDef } from "../catalog/garments";
import { sliceAtHeights } from "../geometry/slice";
import type { SliceAttribute } from "../geometry/slice";
import { buildAdaptiveIndex, subdivideSmooth } from "../geometry/subdivide";
import type { SubdividedMesh } from "../geometry/subdivide";
import { buildGeometry, computeWeldedNormals, weldVertices } from "../geometry/weld";
import type { SurfaceMesh } from "../surface/SurfaceGrid";
import { applyAnatomyBumps, computeLegAxisProfile, inflateThigh, shapeHeel, slimInstep } from "./anatomy";
import { buildForefoot, buildForefootCollision } from "./forefoot";
import type { ForefootCollision, ToeNail } from "./forefoot";
import { parseModelGlb } from "./glb";
import type { ModelData } from "./glb";
import { computeCircumference, computeLegTangents } from "./tangents";
import { applyWrapOffsets, decodeBase64Int16 } from "./wrapOffsets";

/** Coarse (one subdivision) welded mesh used for raycasts, skinning on the CPU and the bow fit. */
export interface CollisionMesh {
  pos: Float32Array;
  uv: Float32Array;
  idx: Uint32Array;
  nrm: Float32Array;
}

/**
 * Where a stocking's render mesh gets rings of vertices around its cuff's edge, as heights relative to it: the
 * cuff presses the leg in below its edge and lets it bulge out above (pressCuff in the leg shaders), within a
 * few millimeters, which the leg's own triangles (a centimeter across on the thigh) are far too coarse to
 * follow. Every millimeter over the bulge, every half where the surface steps out at the edge, every two
 * where the bulge runs out.
 */
export const CUFF_RING_OFFSETS: readonly number[] = [
  ...Array.from({ length: 10 }, (_, i) => -12 + i),
  ...Array.from({ length: 13 }, (_, i) => -2.5 + i * 0.5),
  ...Array.from({ length: 15 }, (_, i) => 4 + i),
  ...Array.from({ length: 4 }, (_, i) => 20 + i * 2),
].map((mm) => mm / 1000);

/** The heights a stocking's cuff can sit at. */
const CUFF_HEIGHTS: readonly number[] = [
  ...new Set(
    Object.values<StockingLengthDef>(STOCKING_LENGTHS)
      .filter((length) => !length.bare)
      .map((length) => length.cuffY),
  ),
];

export interface LegModelOptions {
  /** Subdivision levels for the render mesh (default 2). */
  levels?: number;
  /** Cuff heights to build a ringed render mesh for (default: those of the catalog's lengths). */
  cuffHeights?: readonly number[];
}

export interface LegModel {
  /** Render mesh with adaptive detail near the foot. */
  stocking: THREE.BufferGeometry;
  /**
   * The render mesh for a stocking with its cuff at a given height: the same surface, with rings of vertices
   * around that height for the cuff to press into shape (see CUFF_RING_OFFSETS). All of them share one set of
   * attributes: the stocking's vertices, then those of the rings.
   */
  stockingAtCuff: Map<number, THREE.BufferGeometry>;
  /** Same attributes as `stocking`, coarse index. */
  stockingLow: THREE.BufferGeometry;
  /** The skin of the forefoot with its separate toes (see forefoot.ts), if the model has one. */
  forefoot: THREE.BufferGeometry | null;
  /** Bare skin above the stocking. */
  skin: THREE.BufferGeometry;
  /** Smoothed circumference per 1 cm height bin. */
  circumference: Float64Array;
  /** The stocking's collision mesh. */
  collision: CollisionMesh;
  /** The forefoot's skin as a collision mesh, which a bare leg collides with in front of the join. */
  forefootCollision: ForefootCollision | null;
  /** The toenails, big toe first. */
  nails: ToeNail[];
}

/** Loads a leg model from a .glb (binary) or JSON url. */
export async function loadLegModel(url: string, options?: LegModelOptions): Promise<LegModel> {
  const response = await fetch(url);
  return buildLegModel(
    url.endsWith(".glb") ? parseModelGlb(await response.arrayBuffer()) : ((await response.json()) as ModelData),
    options,
  );
}

export function buildLegModel(
  data: ModelData,
  { levels = 2, cuffHeights = CUFF_HEIGHTS }: LegModelOptions = {},
): LegModel {
  const wrap = data.wrapData || (data.wrap ? decodeBase64Int16(data.wrap) : null);
  let mesh: SubdividedMesh<Float32Array> = {
    pos: new Float32Array(data.stocking.positions),
    uv: new Float32Array(data.stocking.uvs),
    idx: new Uint32Array(data.stocking.indices),
  };
  const axisProfile = computeLegAxisProfile(mesh.pos);
  mesh = subdivideSmooth(mesh.pos, mesh.uv, mesh.idx);
  const coarseWrapped = applyWrapOffsets(mesh.pos, wrap);
  const coarseWeld = weldVertices(coarseWrapped.pos);
  inflateThigh(coarseWrapped.pos, axisProfile);
  slimInstep(coarseWrapped.pos);
  shapeHeel(coarseWrapped.pos);
  const coarseSkinFx = applyAnatomyBumps(coarseWrapped.pos, mesh.idx, coarseWeld);
  const collision: CollisionMesh = {
    pos: coarseWrapped.pos,
    uv: mesh.uv,
    idx: mesh.idx,
    nrm: computeWeldedNormals(coarseWrapped.pos, mesh.idx, coarseWeld),
  };
  for (let level = 1; level < levels; level++) {
    mesh = subdivideSmooth(mesh.pos, mesh.uv, mesh.idx);
  }
  const fineWrapped = levels >= 2 ? applyWrapOffsets(mesh.pos, wrap) : coarseWrapped;
  const fineWeld = levels >= 2 ? weldVertices(fineWrapped.pos) : coarseWeld;
  let skinFx = coarseSkinFx;
  if (levels >= 2) {
    inflateThigh(fineWrapped.pos, axisProfile);
    slimInstep(fineWrapped.pos);
    shapeHeel(fineWrapped.pos);
    skinFx = applyAnatomyBumps(fineWrapped.pos, mesh.idx, fineWeld);
  }
  const stocking = buildGeometry(fineWrapped.pos, mesh.uv, mesh.idx, fineWeld);
  stocking.setAttribute("skinFx", new THREE.BufferAttribute(skinFx, 2));
  stocking.setAttribute("toeShade", new THREE.BufferAttribute(new Float32Array(fineWrapped.pos.length / 3), 1));
  stocking.setAttribute("under", new THREE.BufferAttribute(new Float32Array((fineWrapped.pos.length / 3) * 4), 4));
  computeLegTangents(stocking);
  const circumference = computeCircumference(stocking);
  const stockingLow = new THREE.BufferGeometry();
  for (const attrName of Object.keys(stocking.attributes)) {
    stockingLow.setAttribute(attrName, stocking.attributes[attrName]);
  }
  stockingLow.setIndex(new THREE.BufferAttribute(collision.idx, 1));
  stockingLow.boundingSphere = stocking.boundingSphere;
  stockingLow.boundingBox = stocking.boundingBox;
  if (levels >= 2) {
    stocking.setIndex(
      new THREE.BufferAttribute(buildAdaptiveIndex(collision.idx, mesh.idx, fineWrapped.pos, fineWeld, 0.24), 1),
    );
  }
  // The stocking's render mesh, which the back of the forefoot is laid onto.
  const fine: SurfaceMesh = {
    pos: fineWrapped.pos,
    nrm: stocking.attributes.normal.array,
    uv: mesh.uv,
    idx: stocking.index!.array,
  };
  const forefoot = data.forefoot ? buildForefoot(data.forefoot, fine, collision, circumference) : null;
  const forefootCollision = data.forefoot ? buildForefootCollision(data.forefoot, fine, collision) : null;
  // The mesh once more per cuff height, cut into rings around it. Each cut adds its vertices to the same pool.
  let pool: Record<string, SliceAttribute> = stocking.attributes;
  const ringedIndices = cuffHeights.map((cuffY) => {
    const ringed = sliceAtHeights(
      pool,
      stocking.index!.array,
      CUFF_RING_OFFSETS.map((offset) => cuffY + offset),
      ["normal", "legTangent"],
    );
    pool = Object.fromEntries(
      Object.entries(ringed.attributes).map(([name, array]) => [name, { array, itemSize: pool[name].itemSize }]),
    );
    return ringed.idx;
  });
  const ringedAttributes = Object.entries(pool).map(
    ([name, { array, itemSize }]) => [name, new THREE.BufferAttribute(array as Float32Array, itemSize)] as const,
  );
  const stockingAtCuff = new Map(
    cuffHeights.map((cuffY, i) => {
      const ringed = new THREE.BufferGeometry();
      for (const [name, attribute] of ringedAttributes) {
        ringed.setAttribute(name, attribute);
      }
      ringed.setIndex(new THREE.BufferAttribute(ringedIndices[i], 1));
      ringed.boundingSphere = stocking.boundingSphere;
      ringed.boundingBox = stocking.boundingBox;
      return [cuffY, ringed];
    }),
  );
  const skin = buildGeometry(
    inflateThigh(new Float32Array(data.skinTop.positions), axisProfile),
    null,
    new Uint32Array(data.skinTop.indices),
  );
  computeLegTangents(skin);
  skin.setAttribute(
    "stretch",
    new THREE.BufferAttribute(new Float32Array(skin.attributes.position.count).fill(1.5), 1),
  );
  skin.setAttribute("skinFx", new THREE.BufferAttribute(new Float32Array(skin.attributes.position.count * 2), 2));
  skin.setAttribute("toeShade", new THREE.BufferAttribute(new Float32Array(skin.attributes.position.count), 1));
  skin.setAttribute("under", new THREE.BufferAttribute(new Float32Array(skin.attributes.position.count * 4), 4));
  skin.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(skin.attributes.position.count * 2).fill(-1), 2));
  return {
    stocking: stocking,
    stockingAtCuff: stockingAtCuff,
    stockingLow: stockingLow,
    skin: skin,
    circumference: circumference,
    collision: collision,
    forefoot: forefoot,
    forefootCollision: forefootCollision,
    nails: data.forefoot?.nails ?? [],
  };
}
