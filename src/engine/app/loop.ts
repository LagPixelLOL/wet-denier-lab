/**
 * Resize and adaptive resolution, idle detection and the frame loop.
 */
import * as THREE from "three";
import { app } from "./runtime";
import { orbit, updateCamera } from "./camera";
import { IS_PROD } from "./config";
import { pointers } from "./input";
import { sheetCovers } from "./layout";
import { takePhoto } from "./photo";
import { frontLeg, updateAwayLeg } from "./scene";
import { maybeIntroSplash, pick, pourAt, splashAt } from "./splash";
import { state } from "./state";
import { refreshThumbs, renderThumb, thumbJobs } from "./thumbnails";

export function resize() {
  const w = app.canvas.clientWidth;
  const h = app.canvas.clientHeight;
  const pixelBudget = (app.isMobile ? 2200000 : 4200000) * app.resolutionScale;
  const dpr =
    (!IS_PROD && globalThis.__YUSI_DPR__) ||
    Math.min(window.devicePixelRatio || 1, app.isMobile ? 2.5 : 2, Math.sqrt(pixelBudget / (w * h)));
  app.renderer.setPixelRatio(dpr);
  app.renderer.setSize(w, h, false);
  app.camera.aspect = w / h;
  app.camera.fov = w / h < 0.75 ? 34 : 30;
  app.camera.updateProjectionMatrix();
  const bufSize = app.renderer.getDrawingBufferSize(new THREE.Vector2());
  app.sceneTarget.setSize(bufSize.x, bufSize.y);
  if (app.stage) {
    app.stage.viewport.copy(bufSize);
    app.stage.resizeMirror(bufSize.x, bufSize.y, app.isMobile ? 0.34 : 0.5);
  }
}

const tmpProj = new THREE.Vector3();

function stereoPan(x: number, y: number, z: number) {
  tmpProj.set(x, y, z).project(app.camera);
  if (Number.isFinite(tmpProj.x)) {
    return THREE.MathUtils.clamp(tmpProj.x * 0.75, -0.75, 0.75);
  } else {
    return 0;
  }
}

interface PerfMonitor {
  /** Seconds and frames counted in the current sample window. */
  t: number;
  frames: number;
  /** Quality steps taken so far (mirror off, then lower resolution). */
  steps: number;
  /** Seconds left before sampling resumes. */
  hold: number;
}

const perfMonitor: PerfMonitor = {
  t: 0,
  frames: 0,
  steps: 0,
  hold: 3,
};

export function holdPerf(seconds: number) {
  perfMonitor.hold = Math.max(perfMonitor.hold, seconds);
  perfMonitor.t = 0;
  perfMonitor.frames = 0;
}

function checkPerf(dt: number) {
  if (perfMonitor.steps >= 3 || document.hidden) {
    return;
  }
  if (perfMonitor.hold > 0 || app.rig.moving) {
    perfMonitor.hold -= dt;
    perfMonitor.t = 0;
    perfMonitor.frames = 0;
    return;
  }
  perfMonitor.t += dt;
  perfMonitor.frames++;
  if (perfMonitor.t < 2.5) {
    return;
  }
  const fps = perfMonitor.frames / perfMonitor.t;
  perfMonitor.t = 0;
  perfMonitor.frames = 0;
  if (!(fps >= 42)) {
    perfMonitor.steps++;
    if (perfMonitor.steps === 2) {
      app.stage.setMirror(false);
    } else {
      app.resolutionScale *= 0.66;
      resize();
    }
  }
}

function isIdle() {
  const cur = orbit.cur;
  return (
    pointers.size === 0 &&
    !app.pour &&
    !app.rig.moving &&
    !state.rain &&
    app.shakeTime <= 0 &&
    app.water.drops.length === 0 &&
    !app.water.sliding &&
    (app.idleTime < 9 || app.reducedMotionQuery.matches || sheetCovers()) &&
    Math.abs(orbit.yaw - cur.yaw) < 0.001 &&
    Math.abs(orbit.pitch - cur.pitch) < 0.001 &&
    Math.abs(orbit.dist - cur.dist) < 0.001 &&
    cur.target.distanceToSquared(orbit.target) < 1e-7 &&
    Math.abs(app.sheetZoomGoal - app.sheetZoom) < 0.003 &&
    app.insetShift === app.insetShiftGoal &&
    thumbJobs.length === 0
  );
}

export function trackUserActivity() {
  window.addEventListener(
    "pointerdown",
    () => {
      app.idleTime = 0;
    },
    true,
  );
  window.addEventListener(
    "wheel",
    () => {
      app.idleTime = 0;
    },
    true,
  );
}

export function frame(now: number) {
  requestAnimationFrame(frame);
  if (!app.isMobile || !((app.idle = isIdle()), now - app.lastFrameTime < (app.idle ? 30 : 10.5))) {
    app.lastFrameTime = now;
    step(now);
  }
}

export function step(now: number, fixedDt?: number) {
  const dt = fixedDt === undefined ? Math.min(0.05, (now - app.lastTime) / 1000) : fixedDt;
  app.lastTime = now;
  const simDt = dt * (state.slow ? 0.2 : 1);
  updateCamera(dt);
  app.stage.aimLights(orbit.cur.yaw, orbit.cur.pitch);
  app.stage.uniforms.floor.uFloorFade.value = THREE.MathUtils.smoothstep(0.04 - app.camera.position.y, 0, 0.04);
  updateAwayLeg();
  const poseState = app.rig.update(dt);
  if (poseState === "moving" || poseState === "settled") {
    app.wetmap.bake(poseState === "settled");
  }
  app.oddFrame = !app.oddFrame;
  if (
    thumbJobs.length &&
    !poseState &&
    !app.rig.moving &&
    app.rig.awayNow[0] === 0 &&
    app.rig.awayNow[1] === 0 &&
    !app.previewBackup &&
    (!app.isMobile || app.oddFrame)
  ) {
    renderThumb(thumbJobs.shift()!);
  } else if (app.frameCount++ % 40 === 0) {
    refreshThumbs();
  }
  if (poseState || !app.isMobile || app.oddFrame) {
    app.stage.bakeShadow(!!poseState);
  }
  app.stage.setOrder(frontLeg());
  const shadowParam = app.stage.uniforms.floor.uLogoRect.value;
  shadowParam.y += (Math.max(0.27, app.rig.front + 0.05) - shadowParam.y) * (1 - Math.exp(-dt * 6));
  if (app.pour) {
    if (app.pour.pending) {
      app.pour.age += dt;
      if (app.pour.age > 0.06) {
        splashAt(app.pour.pending);
        app.pour.pending = null;
      }
    } else {
      app.pour.acc += dt;
      if (app.pour.acc > 0.045) {
        app.pour.acc = 0;
        const hit = pick(app.pour.x, app.pour.y);
        if (hit) {
          pourAt(hit);
        }
      }
    }
  }
  app.idleTime += dt;
  if (app.reducedMotionQuery.matches) {
    app.shakeTime = 0;
  } else if (app.idleTime > 9 && pointers.size === 0 && !sheetCovers()) {
    orbit.yaw += dt * 0.12 * Math.min(1, (app.idleTime - 9) / 3);
  }
  if (app.shakeTime > 0) {
    app.shakeTime = Math.max(0, app.shakeTime - dt);
    const amp = app.shakeTime * 0.006;
    app.camera.position.x += (Math.random() - 0.5) * amp;
    app.camera.position.y += (Math.random() - 0.5) * amp;
    app.camera.updateMatrixWorld();
  }
  if (!app.idle) {
    checkPerf(dt);
  }
  if (app.dryTimer > 0) {
    app.dryTimer -= dt;
    if (app.dryTimer <= 0) {
      app.wetmap.updateMat.uniforms.uDryRate.value = 1 / 70;
    }
  }
  maybeIntroSplash();
  app.water.update(simDt);
  app.wetmapDt += simDt;
  if (!app.isMobile || app.oddFrame) {
    app.wetmap.update(app.wetmapDt);
    app.wetmapDt = 0;
  }
  app.stage.uniforms.fabric.uWetMap.value = app.wetmap.texture;
  app.stage.uniforms.floor.uTime.value = app.water.time;
  app.stage.uniforms.fabric.uTime.value = app.water.time;
  const bgU = app.stage.uniforms.bg;
  bgU.uBackdropTime.value = app.water.time;
  bgU.uPixelAngle.value = (Math.tan(THREE.MathUtils.degToRad(app.camera.fov / 2)) * 2) / app.stage.viewport.y;
  bgU.uFocusDist.value = app.camera.position.distanceTo(orbit.cur.target);
  bgU.uRain.value += ((state.rain ? 1 : 0) - bgU.uRain.value) * (1 - Math.exp(-dt * 3));
  const events = app.water.events;
  if (events.impacts) {
    const inv = 1 / Math.max(events.energy, 1e-9);
    app.sound.splash(Math.min(1, events.energy * 0.7), stereoPan(events.ex * inv, events.ey * inv, events.ez * inv));
  }
  if (events.energy > 2.5 && !state.slow) {
    app.shakeTime = Math.max(app.shakeTime, 0.22);
  }
  if (events.floor) {
    app.sound.drip(Math.random(), stereoPan(events.fx, 0, events.fz));
  }
  events.impacts = 0;
  events.energy = 0;
  events.floor = 0;
  events.ex = events.ey = events.ez = 0;
  app.stage.renderMirror(app.camera);
  app.renderer.setRenderTarget(app.sceneTarget);
  app.renderer.clear();
  app.renderer.render(app.stage.scene, app.camera);
  app.renderer.setRenderTarget(null);
  app.renderer.clear();
  app.stage.blit(app.sceneTarget.texture, app.sceneTarget.depthTexture);
  app.water.sync(app.camera, app.sceneTarget.texture, app.stage.viewport, app.stage.uniforms.light.uKeyDir.value);
  app.renderer.render(app.water.scene, app.camera);
  if (app.photoRequested) {
    app.photoRequested = false;
    takePhoto();
  }
  if (app.captureRequest) {
    const { name: shotName, done } = app.captureRequest;
    app.captureRequest = null;
    fetch("/__capture?name=" + shotName, {
      method: "POST",
      body: app.canvas.toDataURL("image/png"),
    }).then(done, done);
  }
}
