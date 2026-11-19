/**
 * Scenes, backdrops, rain, poses and which leg is "away" from the camera.
 */
import * as THREE from "three";
import { ui } from "../../state/ui";
import { app } from "./runtime";
import { publishScenes, publishWardrobe } from "./sheets";
import { homeView, orbit } from "./camera";
import { holdPerf } from "./loop";
import { state } from "./state";
import { SCENES, type SceneId } from "../stage/scenes";

function applyScene(id: string) {
  holdPerf(1.5);
  const sceneDef = app.stage.setScene(id);
  state.scene = SCENES[id] ? id : "studio";
  app.water.setLook(sceneDef.water);
  app.water.setRainStyle(sceneDef.id === 1 ? "shower" : "rain");
  if (app.sound.setScene) {
    app.sound.setScene(state.scene);
  }
  updateStageTone();
  if (sceneDef.rainOn && !state.rain) {
    setRain(true);
    app.autoRain = true;
  } else if (!sceneDef.rainOn && app.autoRain) {
    setRain(false);
    app.autoRain = false;
  }
  ui.set({ rainLabel: `scene.${state.scene as SceneId}.rain` });
  publishScenes();
}

export function setScene(id: string, opts?: { instant?: boolean }) {
  if (!SCENES[id] || id === state.scene) {
    return;
  }
  if (opts && opts.instant) {
    app.sceneSwapId++;
    applyScene(id);
    return;
  }
  const token = ++app.sceneSwapId;
  document.body.classList.add("scene-out");
  Promise.all([app.stage.warmScene(id, app.camera), new Promise((resolve) => setTimeout(resolve, 220))]).then(() => {
    if (token === app.sceneSwapId) {
      applyScene(id);
      setTimeout(() => {
        if (token !== app.sceneSwapId) {
          return;
        }
        const cls = document.body.classList;
        cls.add("scene-in");
        cls.remove("scene-out");
        setTimeout(() => cls.remove("scene-in"), 450);
      }, 60);
    }
  });
}

export function setBackdrop(id: string) {
  state.backdrop = id;
  app.stage.setBackdrop(id);
  updateStageTone();
  publishScenes();
}

function updateStageTone() {
  const sceneDef = app.stage.sceneNow;
  const isStudio = sceneDef.id === 0;
  document.documentElement.style.setProperty("--stage", isStudio ? app.stage.backdropNow.bottom : sceneDef.fade);
  document.body.classList.toggle("dim", !!(isStudio ? app.stage.backdropNow.dark : sceneDef.dark));
}

export function setRain(on: boolean) {
  state.rain = on;
  app.autoRain = false;
  app.water.setRain(on);
  app.sound.setRain(on);
  ui.set({ rain: on });
}

export function setPose(pose: string, opts?: { instant?: boolean }) {
  if (app.rig.setPose(pose, opts)) {
    app.water.shakeOff();
    syncFootprint();
    publishWardrobe();
    if (opts && opts.instant) {
      app.wetmap.bake();
      app.stage.bakeShadow(true);
      app.stage.uniforms.floor.uLogoRect.value.y = Math.max(0.27, app.rig.front + 0.05);
    }
  }
}

export function syncFootprint() {
  const fp = app.rig.footprint;
  app.water.setFootprint(fp.x, fp.z, fp.w, fp.d);
  app.water.setLegCount(app.rig.solo ? 1 : 2);
  const homeDist = app.rig.solo ? 2.45 : 2.5;
  if (Math.abs(orbit.dist - homeView.dist) < 0.02) {
    orbit.dist += homeDist - homeView.dist;
  }
  homeView.dist = homeDist;
}

/** A leg fades once the camera is inside it or this close to its surface (the near plane clips at 0.02). */
const CLIP_FADE_IN = 0.05;

/** ...and shows again once the camera is this far out, so it does not flicker at the edge. */
const CLIP_FADE_OUT = 0.07;

/** Widest leg radius (thigh top); a camera farther than this plus CLIP_FADE_OUT from both axes is clear of both. */
const MAX_LEG_RADIUS = 0.14;

/** The shown leg the camera is inside or about to clip into, or -1. */
function clippedLeg(): number {
  const eye = app.camera.position;
  const reach = MAX_LEG_RADIUS + CLIP_FADE_OUT;
  if (app.rig.visibleLegs.every((i) => app.rig.distanceToLeg(i, eye.x, eye.y, eye.z) > reach)) {
    return -1;
  }
  const hit = app.surface.closest(eye.x, eye.y, eye.z, MAX_LEG_RADIUS);
  if (!hit) {
    return -1;
  }
  const gap = Math.hypot(eye.x - hit.x, eye.y - hit.y, eye.z - hit.z);
  return hit.side < 0 || gap < (app.rig.away[hit.leg] ? CLIP_FADE_OUT : CLIP_FADE_IN) ? hit.leg : -1;
}

export function updateAwayLeg() {
  let away = -1;
  if (app.targetFlash.leg >= 0 && performance.now() < app.targetFlash.until && !app.rig.solo) {
    away = 1 - app.targetFlash.leg;
  } else {
    away = clippedLeg();
  }
  app.rig.setAway(0, away === 0 ? 1 : 0);
  app.rig.setAway(1, away === 1 ? 1 : 0);
}

export function frontLeg(eye = app.camera.position) {
  if (app.rig.awayNow[0] > 0 || app.rig.awayNow[1] > 0) {
    if (app.rig.awayNow[0] > app.rig.awayNow[1]) {
      return 0;
    } else {
      return 1;
    }
  }
  return nearerLeg(eye);
}

/** The leg whose hip is closer to `eye`. */
export function nearerLeg(eye: THREE.Vector3) {
  const root0 = app.rig.legs[0].axis[0];
  const root1 = app.rig.legs[1].axis[0];
  if (
    Math.hypot(eye.x - root0[0], eye.y - root0[1], eye.z - root0[2]) <=
    Math.hypot(eye.x - root1[0], eye.y - root1[1], eye.z - root1[2])
  ) {
    return 0;
  } else {
    return 1;
  }
}
