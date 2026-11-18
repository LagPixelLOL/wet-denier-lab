/**
 * Scenes, backdrops, rain, poses and which leg is "away" from the camera.
 */
import * as THREE from "three";
import { app } from "./runtime";
import { homeView, orbit } from "./camera";
import { $ } from "./dom";
import { holdPerf } from "./loop";
import { state } from "./state";
import { SCENES } from "../stage/scenes";

function applyScene(id) {
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
  $("#rainBtn span").textContent = sceneDef.rainLabel;
  if (app.scenePicker) {
    app.scenePicker.sync();
  }
}

export function setScene(id, opts) {
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

export function setBackdrop(id) {
  state.backdrop = id;
  app.stage.setBackdrop(id);
  updateStageTone();
  if (app.scenePicker) {
    app.scenePicker.sync();
  }
}

function updateStageTone() {
  const sceneDef = app.stage.sceneNow;
  const isStudio = sceneDef.id === 0;
  document.documentElement.style.setProperty("--stage", isStudio ? app.stage.backdropNow.bottom : sceneDef.fade);
  document.body.classList.toggle("dim", !!(isStudio ? app.stage.backdropNow.dark : sceneDef.dark));
}

export function setRain(on) {
  state.rain = on;
  app.autoRain = false;
  app.water.setRain(on);
  app.sound.setRain(on);
  $("#rainBtn").setAttribute("aria-pressed", String(on));
}

export function setPose(pose, opts) {
  if (app.rig.setPose(pose, opts)) {
    app.water.shakeOff();
    syncFootprint();
    if (app.wardrobe) {
      app.wardrobe.sync();
    }
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
  const homeDist = app.rig.solo ? 1.95 : 2;
  const offset = orbit.dist - homeView.dist;
  if (Math.abs(offset) < 0.02 || Math.abs(offset - 0.5) < 0.02) {
    orbit.dist += homeDist - homeView.dist;
  }
  homeView.dist = homeDist;
}

const tmpDir = new THREE.Vector3();

export function updateAwayLeg() {
  let away = -1;
  if (app.targetFlash.leg >= 0 && performance.now() < app.targetFlash.until && !app.rig.solo) {
    away = 1 - app.targetFlash.leg;
  } else if (!app.rig.solo && orbit.cur.dist < 1.3) {
    const focus = orbit.cur.target;
    const d0 = app.rig.distanceToLeg(0, focus.x, focus.y, focus.z);
    const d1 = app.rig.distanceToLeg(1, focus.x, focus.y, focus.z);
    const near = d0 < d1 ? 0 : 1;
    if (Math.min(d0, d1) < 0.075 && Math.abs(d0 - d1) > 0.03) {
      const eye = app.camera.position;
      let blocked = 0;
      for (const dy of [-0.05, 0, 0.05]) {
        tmpDir.set(focus.x, focus.y + dy, focus.z).sub(eye);
        const dist = tmpDir.length();
        tmpDir.divideScalar(dist);
        const hit = app.surface.raycast(eye.x, eye.y, eye.z, tmpDir.x, tmpDir.y, tmpDir.z, dist);
        if (hit && hit.leg !== near && hit.t < dist - 0.02) {
          blocked++;
        }
      }
      if (blocked >= (app.rig.away[1 - near] ? 1 : 2)) {
        away = 1 - near;
      }
    }
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
