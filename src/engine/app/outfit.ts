/**
 * Outfit per leg: wearing specs and presets, preset previews and the target leg.
 */
import { app } from "./runtime";
import { applyView, currentView } from "./camera";
import { publishWardrobe } from "./sheets";
import { setBackdrop, setPose, setScene } from "./scene";
import { outfit, state } from "./state";
import { PRESETS, randomLegSpec, withLegDefaults, type LegSpec, type OutfitPreset } from "../catalog/presets";
import { resolveLegLook } from "../catalog/resolveLegLook";
import { computeBowMatrix } from "../stage/bow";
import type { Look, SharedLook } from "../share/lookCodec";

export function wear(patch: Partial<LegSpec> | undefined, which = outfit.target) {
  if (app.rig.solo && arguments.length < 2) {
    which = -1;
  }
  for (let i = 0; i < 2; i++) {
    if ((which !== 0 && which !== 1) || i === which) {
      outfit.legs[i] = withLegDefaults({
        ...outfit.legs[i],
        ...patch,
      });
      refreshLeg(i);
    }
  }
}

export function applyStocking(leg: number, spec: Partial<LegSpec>) {
  const resolved = resolveLegLook(spec);
  app.stage.setStocking(leg, resolved, resolved.bow ? computeBowMatrix(app.legModel.collision, resolved.cuffY) : null);
  return resolved;
}

function refreshLeg(leg: number) {
  const resolved = applyStocking(leg, outfit.legs[leg]);
  app.wetmap.setLegWater(leg, resolved.water);
  app.water.setLegWater(leg, resolved.water);
}

export function previewPreset(index: number | null) {
  if (index === null) {
    if (!app.previewBackup) {
      return;
    }
    outfit.legs[0] = app.previewBackup[0];
    outfit.legs[1] = app.previewBackup[1];
    app.previewBackup = null;
  } else {
    app.previewBackup ||= outfit.legs.slice();
    const preset = PRESETS[index];
    const specs = preset.legs || [preset.both, preset.both];
    for (let i = 0; i < 2; i++) {
      outfit.legs[i] = withLegDefaults(specs[i]);
    }
  }
  refreshLeg(0);
  refreshLeg(1);
}

export function setTargetLeg(leg: number) {
  outfit.target = leg;
  if ((leg === 0 || leg === 1) && !app.rig.solo) {
    app.targetFlash = {
      leg,
      until: performance.now() + 900,
    };
  }
}

export function wearPreset(preset: Omit<OutfitPreset, "id">) {
  app.previewBackup = null;
  const specs = preset.legs || [preset.both, preset.both];
  for (let i = 0; i < 2; i++) {
    outfit.legs[i] = withLegDefaults({});
    wear(specs[i], i);
  }
  publishWardrobe();
}

export function wearRandom() {
  const spec = randomLegSpec();
  wearPreset(
    Math.random() < 0.8
      ? {
          both: spec,
        }
      : {
          legs: [spec, randomLegSpec()],
        },
  );
}

export function currentLook(): Look {
  return {
    pose: app.rig.name,
    scene: state.scene,
    backdrop: state.backdrop,
    legs: outfit.legs,
    view: currentView(),
  };
}

export function applyLook(lookData: SharedLook) {
  if (lookData.pose) {
    setPose(lookData.pose, {
      instant: true,
    });
  }
  wearPreset({
    legs: lookData.legs,
  });
  if (lookData.backdrop) {
    setBackdrop(lookData.backdrop);
  }
  if (lookData.scene) {
    setScene(lookData.scene, {
      instant: true,
    });
  }
  if (lookData.view) {
    applyView(lookData.view);
  }
}
