/**
 * Shared mutable state of the running app. Fields created at startup are filled in by startApp().
 */
import type * as THREE from "three";
import type { SoundEngine } from "../audio/SoundEngine";
import type { LegSpec } from "../catalog/presets";
import type { LegModel } from "../model/legModel";
import type { LegRig } from "../rig/LegRig";
import type { Stage } from "../stage/createStage";
import type { SurfaceGrid } from "../surface/SurfaceGrid";
import type { ThrowTarget, WaterSim } from "../water/WaterSim";
import type { WetMap } from "../water/WetMap";

/** A picked surface point (copied out of the reused SurfaceHit). */
export type PickHit = ThrowTarget;

/** Press-and-drag pouring in water mode. */
export interface PourState {
  id: number;
  x: number;
  y: number;
  acc: number;
  /** First splash, thrown after a short delay unless the pointer is released first. */
  pending: PickHit | null;
  age: number;
}

/** Two-finger pinch zoom and pan. */
export interface PinchState {
  d: number;
  mx: number;
  my: number;
  dist: number;
}

/** Scripted capture requested by the dev hooks, served after the next frame. */
export interface CaptureRequest {
  name: string;
  done: (result: unknown) => void;
}

export interface AppRuntime {
  canvas: HTMLCanvasElement;
  isMobile: boolean;
  reducedMotionQuery: MediaQueryList;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  sound: SoundEngine;
  wideQuery: MediaQueryList;
  roomyQuery: MediaQueryList;
  finePointerQuery: MediaQueryList;
  sheetZoom: number;
  sheetZoomGoal: number;
  insetShift: number;
  insetShiftGoal: number;
  sceneTarget: THREE.WebGLRenderTarget;
  stage: Stage;
  legModel: LegModel;
  rig: LegRig;
  surface: SurfaceGrid;
  wetmap: WetMap;
  water: WaterSim;
  resolutionScale: number;
  introSplashDone: boolean;
  /** Outfit saved while a preset is previewed. */
  previewBackup: LegSpec[] | null;
  targetFlash: {
    leg: number;
    until: number;
  };
  sceneSwapId: number;
  autoRain: boolean;
  dryTimer: number;
  pour: PourState | null;
  pinch: PinchState | null;
  hintTimer: ReturnType<typeof setTimeout> | 0;
  uiBound: boolean;
  thumbCamera: THREE.PerspectiveCamera;
  thumbTarget: THREE.WebGLRenderTarget | null;
  thumbReadTarget: THREE.WebGLRenderTarget | null;
  thumbPixels: Uint8Array | null;
  photoRequested: boolean;
  lastTime: number;
  idleTime: number;
  shakeTime: number;
  oddFrame: boolean;
  wetmapDt: number;
  frameCount: number;
  lastFrameTime: number;
  idle: boolean;
  captureRequest: CaptureRequest | null;
}

// Fields initialized with `undefined!` stay undefined until startApp()/boot() assign them;
// they are typed as always present because nothing reads them earlier.
export const app: AppRuntime = {
  canvas: undefined!,
  isMobile: undefined!,
  reducedMotionQuery: undefined!,
  renderer: undefined!,
  camera: undefined!,
  sound: undefined!,
  wideQuery: undefined!,
  roomyQuery: undefined!,
  finePointerQuery: undefined!,
  sheetZoom: 0,
  sheetZoomGoal: 0,
  insetShift: 0,
  insetShiftGoal: 0,
  sceneTarget: undefined!,
  stage: undefined!,
  legModel: undefined!,
  rig: undefined!,
  surface: undefined!,
  wetmap: undefined!,
  water: undefined!,
  resolutionScale: 1,
  introSplashDone: false,
  previewBackup: null,
  targetFlash: {
    leg: -1,
    until: 0,
  },
  sceneSwapId: 0,
  autoRain: false,
  dryTimer: 0,
  pour: null,
  pinch: null,
  hintTimer: 0,
  uiBound: false,
  thumbCamera: undefined!,
  thumbTarget: null,
  thumbReadTarget: null,
  thumbPixels: null,
  photoRequested: false,
  lastTime: undefined!,
  idleTime: 0,
  shakeTime: 0,
  oddFrame: false,
  wetmapDt: 0,
  frameCount: 0,
  lastFrameTime: 0,
  idle: false,
  captureRequest: null,
};
