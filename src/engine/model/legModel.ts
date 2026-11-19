/**
 * Loads the leg model and builds the render, collision and stretch data used by the rest of the engine.
 */
import * as THREE from "three";
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

export interface LegModelOptions {
  /** Subdivision levels for the render mesh (default 2). */
  levels?: number;
}

export interface LegModel {
  /** Render mesh with adaptive detail near the foot. */
  stocking: THREE.BufferGeometry;
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

export function buildLegModel(data: ModelData, { levels = 2 }: LegModelOptions = {}): LegModel {
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
  skin.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(skin.attributes.position.count * 2).fill(-1), 2));
  return {
    stocking: stocking,
    stockingLow: stockingLow,
    skin: skin,
    circumference: circumference,
    collision: collision,
    forefoot: forefoot,
    forefootCollision: forefootCollision,
    nails: data.forefoot?.nails ?? [],
  };
}
