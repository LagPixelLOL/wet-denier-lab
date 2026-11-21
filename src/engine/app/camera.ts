/**
 * Orbit camera with a view offset for open panels.
 */
import * as THREE from "three";
import { app, type PickHit } from "./runtime";
import type { CameraView } from "../share/lookCodec";
import { layout } from "./layout";

/** The view the page opens on, and the one the reset button goes back to. */
export const homeView = {
  yaw: 0.62,
  pitch: 0.1,
  dist: 2.45,
  target: new THREE.Vector3(0, 0.43, 0.035),
};

export const orbit = {
  yaw: homeView.yaw,
  pitch: homeView.pitch,
  dist: homeView.dist,
  target: homeView.target.clone(),
  cur: {
    yaw: homeView.yaw + 0.5,
    pitch: 0.18,
    dist: homeView.dist + 0.4,
    target: homeView.target.clone(),
  },
};

export const MIN_DIST = 0.2;

export const MAX_DIST = 3.2;

const MIN_PITCH = -1.3;

const MAX_PITCH = 1.15;

/** `yaw` as the camera reaches it the shortest way round from where it is, instead of unwinding past turns. */
function nearestTurn(yaw: number): number {
  const turn = Math.PI * 2;
  return yaw + turn * Math.round((orbit.cur.yaw - yaw) / turn);
}

export function resetView() {
  orbit.yaw = nearestTurn(homeView.yaw);
  orbit.pitch = homeView.pitch;
  orbit.dist = homeView.dist;
  orbit.target.copy(homeView.target);
}

/** Where the camera is heading (not where it is mid-ease), as stored in share links. */
export function currentView(): CameraView {
  return {
    yaw: orbit.yaw,
    pitch: orbit.pitch,
    dist: orbit.dist,
    target: [orbit.target.x, orbit.target.y, orbit.target.z],
  };
}

/** Moves the camera to a shared view, clamped to the usual limits; the camera eases there. */
export function applyView(view: CameraView) {
  orbit.yaw = nearestTurn(view.yaw);
  orbit.pitch = THREE.MathUtils.clamp(view.pitch, MIN_PITCH, MAX_PITCH);
  orbit.dist = THREE.MathUtils.clamp(view.dist, MIN_DIST, MAX_DIST);
  orbit.target.set(...view.target);
  clampTarget();
}

export function updateCamera(dt: number) {
  const k = 1 - Math.exp(-dt * 9);
  const cur = orbit.cur;
  cur.yaw += (orbit.yaw - cur.yaw) * k;
  cur.pitch += (orbit.pitch - cur.pitch) * k;
  cur.dist += (orbit.dist - cur.dist) * k;
  cur.target.lerp(orbit.target, k);
  const cosPitch = Math.cos(cur.pitch);
  app.camera.position.set(
    cur.target.x + Math.sin(cur.yaw) * cosPitch * cur.dist,
    cur.target.y + Math.sin(cur.pitch) * cur.dist,
    cur.target.z + Math.cos(cur.yaw) * cosPitch * cur.dist,
  );
  app.camera.lookAt(cur.target);
  app.camera.updateMatrixWorld();
  const w = app.canvas.clientWidth;
  const h = app.canvas.clientHeight;
  const kLayout = 1 - Math.exp(-dt * 10);
  app.sheetZoomGoal = !layout.wide && document.body.classList.contains("sheet-open") ? 1 : 0;
  app.sheetZoom += (app.sheetZoomGoal - app.sheetZoom) * kLayout;
  app.insetShiftGoal = layout.wide ? (layout.insetR - layout.insetL) / 2 : 0;
  app.insetShift += (app.insetShiftGoal - app.insetShift) * kLayout;
  if (Math.abs(app.insetShiftGoal - app.insetShift) < 0.4) {
    app.insetShift = app.insetShiftGoal;
  }
  if (app.sheetZoom > 0.002) {
    const zoom = 1 + app.sheetZoom * 0.75;
    const subW = w / zoom;
    const subH = h / zoom;
    app.camera.setViewOffset(subW, subH, -(w - subW) / 2, -h * 0.03 * app.sheetZoom, w, h);
  } else if (Math.abs(app.insetShift) > 0.4) {
    app.camera.setViewOffset(w, h, app.insetShift, 0, w, h);
  } else if (app.camera.view && app.camera.view.enabled) {
    app.camera.clearViewOffset();
  }
}

export function orbitBy(dx: number, dy: number) {
  orbit.yaw -= dx * 0.0085;
  orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.005, MIN_PITCH, MAX_PITCH);
}

export function panBy(dx: number, dy: number) {
  const unitsPerPx =
    (orbit.dist * 2 * Math.tan(THREE.MathUtils.degToRad(app.camera.fov / 2))) / app.canvas.clientHeight;
  const right = new THREE.Vector3().setFromMatrixColumn(app.camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(app.camera.matrixWorld, 1);
  orbit.target.addScaledVector(right, -dx * unitsPerPx).addScaledVector(up, dy * unitsPerPx);
  clampTarget();
}

export function clampTarget() {
  const target = orbit.target;
  target.x = THREE.MathUtils.clamp(target.x, -0.25, 0.25);
  target.y = THREE.MathUtils.clamp(target.y, 0.02, 0.86);
  target.z = THREE.MathUtils.clamp(target.z, -0.2, 0.35);
}

export function zoomBy(factor: number, toward?: PickHit | null) {
  orbit.dist = THREE.MathUtils.clamp(orbit.dist * factor, MIN_DIST, MAX_DIST);
  if (toward && factor < 1) {
    orbit.target.lerp(new THREE.Vector3(toward.x, toward.y, toward.z), 0.18);
    clampTarget();
  }
}
