/**
 * Offscreen-rendered preset and scene thumbnails, a few per frame.
 */
import * as THREE from "three";
import { app } from "./runtime";
import { homeView, orbit } from "./camera";
import { isPanelOpen } from "./layout";
import { holdPerf } from "./loop";
import { applyStocking } from "./outfit";
import { frontLeg } from "./scene";
import { outfit, state } from "./state";
import { PRESETS, withLegDefaults } from "../catalog/presets";
import { SCENE_ORDER } from "../stage/scenes";
import { THUMB_SIZE } from "../ui/sheets";

export const thumbJobs = [];

const thumbKeys = {
  presets: "",
  scenes: "",
};

function queueThumbs(kind) {
  if (!app.wardrobe || !app.scenePicker || app.previewBackup) {
    return;
  }
  const key = kind === "presets" ? app.rig.name : [app.rig.name, state.backdrop, JSON.stringify(outfit.legs)].join("|");
  if (thumbKeys[kind] !== key) {
    thumbKeys[kind] = key;
    for (let i = thumbJobs.length - 1; i >= 0; i--) {
      if (thumbJobs[i].kind === kind) {
        thumbJobs.splice(i, 1);
      }
    }
    if (kind === "presets") {
      PRESETS.forEach((preset, i) =>
        thumbJobs.push({
          kind: kind,
          canvas: app.wardrobe.presetCanvases[i],
          legs: preset.legs || [preset.both, preset.both],
        }),
      );
    } else {
      for (const sceneId of SCENE_ORDER) {
        app.stage.warmScene(sceneId, app.camera).then(() => {
          if (thumbKeys.scenes === key) {
            thumbJobs.push({
              kind: kind,
              canvas: app.scenePicker.canvases[sceneId],
              scene: sceneId,
            });
          }
        });
      }
    }
  }
}

export function refreshThumbs() {
  if (isPanelOpen("scene")) {
    queueThumbs("scenes");
  }
  if (isPanelOpen("mat") && app.wardrobe && app.wardrobe.tab === "preset") {
    queueThumbs("presets");
  }
}

export function renderThumb(job) {
  holdPerf(0.8);
  const w = THUMB_SIZE.w;
  const h = THUMB_SIZE.h;
  if (!app.thumbTarget) {
    app.thumbTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    app.thumbTarget.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    app.thumbReadTarget = new THREE.WebGLRenderTarget(w, h);
    app.thumbPixels = new Uint8Array(w * h * 4);
  }
  const bgU = app.stage.uniforms.bg;
  const floorU = app.stage.uniforms.floor;
  const fabricU = app.stage.uniforms.fabric;
  const saved = {
    scene: state.scene,
    vx: app.stage.viewport.x,
    vy: app.stage.viewport.y,
    line: app.stage.lineWidth.value,
    pix: bgU.uPixelAngle.value,
    focus: bgU.uFocusDist.value,
    fade: bgU.uFloorFade.value,
    puddle: floorU.uPuddleTex.value,
    wet: fabricU.uWetMap.value,
  };
  if (job.scene && job.scene !== saved.scene) {
    app.stage.setScene(job.scene);
  }
  if (job.legs) {
    for (let i = 0; i < 2; i++) {
      applyStocking(i, withLegDefaults(job.legs[i]));
    }
  }
  const yaw = 0.62;
  const pitch = 0.1;
  const dist = app.rig.solo ? 2.02 : 2.18;
  const target = homeView.target;
  const cosPitch = Math.cos(pitch);
  app.thumbCamera.position.set(
    target.x + Math.sin(yaw) * cosPitch * dist,
    target.y + Math.sin(pitch) * dist,
    target.z + Math.cos(yaw) * cosPitch * dist,
  );
  app.thumbCamera.lookAt(target);
  app.thumbCamera.updateMatrixWorld();
  app.stage.viewport.set(w, h);
  app.stage.lineWidth.value = 0.75;
  bgU.uPixelAngle.value = (Math.tan(THREE.MathUtils.degToRad(15)) * 2) / h;
  bgU.uFocusDist.value = dist;
  bgU.uFloorFade.value = 0;
  const savedFloorFade = floorU.uMirrorStrength.value;
  floorU.uMirrorStrength.value = 0;
  floorU.uPuddleTex.value = app.stage.blank;
  fabricU.uWetMap.value = app.stage.blank;
  app.stage.aimLights(yaw, pitch);
  app.stage.bakeShadow(false);
  app.stage.setOrder(frontLeg(app.thumbCamera.position));
  app.renderer.setRenderTarget(app.thumbTarget);
  app.renderer.clear();
  app.renderer.render(app.stage.scene, app.thumbCamera);
  app.renderer.setRenderTarget(app.thumbReadTarget);
  app.renderer.clear();
  app.stage.blit(app.thumbTarget.texture, app.thumbTarget.depthTexture);
  app.renderer.readRenderTargetPixels(app.thumbReadTarget, 0, 0, w, h, app.thumbPixels);
  app.renderer.setRenderTarget(null);
  if (job.scene && job.scene !== saved.scene) {
    app.stage.setScene(saved.scene);
  } else {
    floorU.uMirrorStrength.value = savedFloorFade;
  }
  if (job.legs) {
    for (let i = 0; i < 2; i++) {
      applyStocking(i, outfit.legs[i]);
    }
  }
  app.stage.viewport.set(saved.vx, saved.vy);
  app.stage.lineWidth.value = saved.line;
  bgU.uPixelAngle.value = saved.pix;
  bgU.uFocusDist.value = saved.focus;
  bgU.uFloorFade.value = saved.fade;
  floorU.uPuddleTex.value = saved.puddle;
  fabricU.uWetMap.value = saved.wet;
  app.stage.aimLights(orbit.cur.yaw, orbit.cur.pitch);
  app.stage.bakeShadow(false);
  const ctx = job.canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    img.data.set(app.thumbPixels.subarray((h - 1 - y) * rowBytes, (h - y) * rowBytes), y * rowBytes);
  }
  ctx.putImageData(img, 0, 0);
}
