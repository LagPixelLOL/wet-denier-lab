/**
 * Picking and water actions: splash, pour, bucket and dry.
 */
import * as THREE from "three";
import { app, type PickHit } from "./runtime";
import { hideHint } from "./hud";
import { state } from "./state";

const raycaster = new THREE.Raycaster();

export function pick(clientX: number, clientY: number): PickHit | null {
  const rect = app.canvas.getBoundingClientRect();
  raycaster.setFromCamera(
    new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1),
    app.camera,
  );
  const rayOrigin = raycaster.ray.origin;
  const rayDir = raycaster.ray.direction;
  const hit = app.surface.raycast(
    rayOrigin.x,
    rayOrigin.y,
    rayOrigin.z,
    rayDir.x,
    rayDir.y,
    rayDir.z,
    10,
    app.rig.awayLeg,
  );
  if (!hit || hit.ry > 0.83) {
    return null;
  } else {
    return {
      x: hit.x,
      y: hit.y,
      z: hit.z,
      nx: hit.nx,
      ny: hit.ny,
      nz: hit.nz,
    };
  }
}

function pickToward(point: THREE.Vector3): PickHit | null {
  const eye = app.camera.position;
  const dir = point.clone().sub(eye).normalize();
  const hit = app.surface.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 10, app.rig.awayLeg);
  if (hit) {
    return {
      x: hit.x,
      y: hit.y,
      z: hit.z,
      nx: hit.nx,
      ny: hit.ny,
      nz: hit.nz,
    };
  } else {
    return null;
  }
}

export function buzz(pattern: VibratePattern) {
  if (navigator.userActivation?.hasBeenActive) {
    navigator.vibrate?.(pattern);
  }
}

function splashReach(point: PickHit) {
  return Math.min(0.42, app.camera.position.distanceTo(new THREE.Vector3(point.x, point.y, point.z)) * 0.55);
}

export function splashAt(hit: PickHit) {
  app.water.throwAt(hit, app.camera.position, {
    count: app.isMobile ? 26 : 32,
    reach: splashReach(hit),
  });
  state.splashes++;
  onSplashed();
  buzz(8);
}

export function pourAt(hit: PickHit) {
  app.water.throwAt(hit, app.camera.position, {
    count: app.isMobile ? 6 : 8,
    spread: 0.007,
    flight: 0.13,
    delay: 0.03,
    size: 0.85,
    reach: splashReach(hit) * 0.9,
  });
}

export function bucketSplash() {
  app.sound.unlock();
  const legs = app.rig.visibleLegs;
  const both = legs.length > 1;
  let thrown = false;
  legs.forEach((leg, i) => {
    const height = 0.32 + Math.random() * 0.3;
    const hit = pickToward(new THREE.Vector3(...app.rig.point(leg, 0, height, 0.04)));
    if (!hit) {
      return;
    }
    const count = Math.round((app.isMobile ? 120 : 170) * (both ? 0.72 : 1));
    app.water.throwAt(hit, app.camera.position, {
      count: count,
      spread: 0.045,
      size: 1.25,
      flight: 0.24,
      reach: Math.min(0.62, splashReach(hit) * 1.4),
      lift: 0.16,
      delay: 0.1,
      wait: i * 0.07,
    });
    thrown = true;
  });
  if (thrown) {
    state.splashes++;
    onSplashed();
    buzz([10, 30, 14]);
  }
}

export function dryOff() {
  app.water.beads.length = 0;
  app.water.drops.length = 0;
  app.water.puddle.fill(0);
  app.wetmap.updateMat.uniforms.uDryRate.value = 3.6;
  app.dryTimer = 0.8;
}

function onSplashed() {
  if (state.splashes === 1) {
    setTimeout(hideHint, 1600);
  }
}
