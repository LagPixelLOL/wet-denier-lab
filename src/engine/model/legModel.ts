/**
 * Loads the leg model and builds the render, collision and stretch data used by the rest of the engine.
 */
import * as THREE from "three";
import { buildAdaptiveIndex, subdivideSmooth } from "../geometry/subdivide";
import { buildGeometry, computeWeldedNormals, weldVertices } from "../geometry/weld";
import { applyAnatomyBumps, computeLegAxisProfile, inflateThigh } from "./anatomy";
import { parseModelGlb } from "./glb";
import { computeCircumference, computeLegTangents } from "./tangents";
import { applyWrapOffsets, decodeBase64Int16 } from "./wrapOffsets";

export async function loadLegModel(url, options) {
  const response = await fetch(url);
  return buildLegModel(
    url.endsWith(".glb") ? parseModelGlb(await response.arrayBuffer()) : await response.json(),
    options,
  );
}

function buildLegModel(data, { levels = 2 } = {}) {
  const wrap = data.wrapData || (data.wrap ? decodeBase64Int16(data.wrap) : null);
  let mesh = {
    pos: new Float32Array(data.stocking.positions),
    uv: new Float32Array(data.stocking.uvs),
    idx: new Uint32Array(data.stocking.indices),
  };
  const axisProfile = computeLegAxisProfile(mesh.pos);
  mesh = subdivideSmooth(mesh.pos, mesh.uv, mesh.idx);
  const coarseWrapped = applyWrapOffsets(mesh.pos, wrap);
  const coarseWeld = weldVertices(coarseWrapped.pos);
  inflateThigh(coarseWrapped.pos, axisProfile);
  const coarseSkinFx = applyAnatomyBumps(coarseWrapped.pos, mesh.idx, coarseWeld);
  const collision = {
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
    skinFx = applyAnatomyBumps(fineWrapped.pos, mesh.idx, fineWeld);
  }
  const stocking = buildGeometry(fineWrapped.pos, mesh.uv, mesh.idx, fineWeld);
  stocking.setAttribute("gapNail", new THREE.BufferAttribute(fineWrapped.gapNail, 2));
  stocking.setAttribute("skinFx", new THREE.BufferAttribute(skinFx, 2));
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
  skin.setAttribute("gapNail", new THREE.BufferAttribute(new Float32Array(skin.attributes.position.count * 2), 2));
  skin.setAttribute("skinFx", new THREE.BufferAttribute(new Float32Array(skin.attributes.position.count * 2), 2));
  skin.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(skin.attributes.position.count * 2).fill(-1), 2));
  return {
    stocking: stocking,
    stockingLow: stockingLow,
    skin: skin,
    circumference: circumference,
    collision: collision,
  };
}
