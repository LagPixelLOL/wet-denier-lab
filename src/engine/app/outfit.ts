/**
 * Outfit per leg: wearing specs and presets, preset previews and the target leg.
 */
import { app } from "./runtime";
import { publishWardrobe } from "./sheets";
import { setBackdrop, setPose, setScene } from "./scene";
import { outfit, state } from "./state";
import { PRESETS, randomLegSpec, withLegDefaults } from "../catalog/presets";
import { resolveLegLook } from "../catalog/resolveLegLook";
import { computeBowMatrix } from "../stage/bow";

export function wear(patch, which = outfit.target) {
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

export function applyStocking(leg, spec) {
  const resolved = resolveLegLook(spec);
  app.stage.setStocking(leg, resolved, resolved.bow ? computeBowMatrix(app.legModel.collision, resolved.cuffY) : null);
  return resolved;
}

function refreshLeg(leg) {
  const resolved = applyStocking(leg, outfit.legs[leg]);
  app.wetmap.setLegWater(leg, resolved.water);
  app.water.setLegWater(leg, resolved.water);
}

export function previewPreset(index) {
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

export function setTargetLeg(leg) {
  outfit.target = leg;
  if ((leg === 0 || leg === 1) && !app.rig.solo) {
    app.targetFlash = {
      leg: leg,
      until: performance.now() + 900,
    };
  }
}

export function wearPreset(preset) {
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

export function currentLook() {
  return {
    pose: app.rig.name,
    scene: state.scene,
    backdrop: state.backdrop,
    legs: outfit.legs,
  };
}

export function applyLook(lookData) {
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
}
