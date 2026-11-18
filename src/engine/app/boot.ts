/**
 * Startup: creates the renderer and runtime, loads the model and starts the frame loop.
 */
import * as THREE from "three";
import { app } from "./runtime";
import { orbit } from "./camera";
import { IS_PROD, MODEL_URL } from "./config";
import { installDevHooks } from "./devHooks";
import { $ } from "./dom";
import { bindUi } from "./input";
import { applyLayout, layout, setPanel } from "./layout";
import { frame, holdPerf, resize, trackUserActivity } from "./loop";
import { applyLook, currentLook, wear, wearPreset, wearRandom } from "./outfit";
import { setBackdrop, setPose, setRain, setScene, syncFootprint } from "./scene";
import { pick, splashAt } from "./splash";
import { outfit, state } from "./state";
import { thumbJobs } from "./thumbnails";
import { SoundEngine } from "../audio/SoundEngine";
import { PRESETS } from "../catalog/presets";
import { loadLegModel } from "../model/legModel";
import { LegRig } from "../rig/LegRig";
import { lookUrl, unpackLook } from "../share/lookCodec";
import { createStage } from "../stage/createStage";
import { SCENES } from "../stage/scenes";
import { THUMB_SIZE } from "../ui/sheets";
import { WaterSim } from "../water/WaterSim";
import { WetMap } from "../water/WetMap";

async function boot() {
  const t0 = performance.now();
  app.legModel = await loadLegModel(MODEL_URL, {
    levels: 2,
  });
  const legMs = performance.now() - t0;
  app.stage = createStage(app.renderer, app.legModel);
  app.rig = new LegRig(app.legModel.collision, app.stage);
  app.surface = app.rig.surface;
  app.wetmap = new WetMap(
    app.renderer,
    app.legModel.stockingLow,
    app.surface,
    app.isMobile ? 1024 : 2048,
    app.stage.legs,
  );
  app.water = new WaterSim({
    surface: app.surface,
    wetmap: app.wetmap,
    mobile: app.isMobile,
  });
  syncFootprint();
  app.stage.uniforms.floor.uPuddleTex.value = app.water.puddleTex;
  app.stage.uniforms.floor.uRipples.value = app.water.ripples;
  resize();
  new ResizeObserver(resize).observe(app.canvas);
  bindUi();
  applyLayout();
  addEventListener("resize", applyLayout);
  addEventListener("resize", () => holdPerf(1));
  document.addEventListener("visibilitychange", () => holdPerf(1.5));
  const shared = unpackLook(location.hash);
  if (shared) {
    applyLook(shared);
  }
  addEventListener("hashchange", () => {
    const linked = unpackLook(location.hash);
    if (linked) {
      applyLook(linked);
    }
  });
  if (!IS_PROD) {
    window.__app = {
      THREE: THREE,
      renderer: app.renderer,
      camera: app.camera,
      view: orbit,
      look: app.stage,
      leg: app.legModel,
      body: app.rig,
      surface: app.surface,
      wetmap: app.wetmap,
      water: app.water,
      state: state,
      pick: pick,
      splashAt: splashAt,
      setPose: setPose,
      wear: wear,
      wearPreset: wearPreset,
      wearRandom: wearRandom,
      setScene: setScene,
      setBackdrop: setBackdrop,
      setRain: setRain,
      setPanel: setPanel,
      applyLayout: applyLayout,
      currentLook: currentLook,
      applyLook: applyLook,
      lookUrl: lookUrl,
      unpackLook: unpackLook,
      layout: layout,
      SCENES: SCENES,
      outfit: outfit,
      PRESETS: PRESETS,
      audio: app.sound,
      legMs: legMs,
      thumbJobs: thumbJobs,
      get wardrobe() {
        return app.wardrobe;
      },
      get scenePicker() {
        return app.scenePicker;
      },
    };
  }
  requestAnimationFrame(frame);
  setTimeout(() => document.body.classList.add("ready"), 120);
}

export function startApp() {
  app.canvas = $("#view");
  app.isMobile = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 600;
  app.reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  app.renderer = new THREE.WebGLRenderer({
    canvas: app.canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  app.renderer.autoClear = false;
  app.renderer.setClearColor(15920883, 1);
  app.camera = new THREE.PerspectiveCamera(30, 1, 0.02, 12);
  app.sound = new SoundEngine();
  app.wideQuery = matchMedia("(min-aspect-ratio: 1/1) and (min-width: 600px)");
  app.roomyQuery = matchMedia("(min-width: 1000px) and (min-height: 600px)");
  app.finePointerQuery = matchMedia("(hover: hover) and (pointer: fine)");
  app.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  app.sceneTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  app.thumbCamera = new THREE.PerspectiveCamera(30, THUMB_SIZE.w / THUMB_SIZE.h, 0.02, 12);
  app.lastTime = performance.now();
  trackUserActivity();
  if (!IS_PROD) installDevHooks();
  boot().catch((err) => {
    console.error(err);
    $("#loading").innerHTML = "三维画面启动失败：" + err.message + "<br>请用最新版 Chrome / Safari / Edge 打开";
  });
}
