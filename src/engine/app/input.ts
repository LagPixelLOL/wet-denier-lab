/**
 * Pointer, wheel, pinch and keyboard input plus toolbar wiring.
 */
import * as THREE from "three";
import { POSE_ORDER } from "../rig/poses";
import { toggleSlow } from "./actions";
import { MAX_DIST, MIN_DIST, clampTarget, orbit, orbitBy, panBy, resetView, zoomBy } from "./camera";
import { setMode, showHint } from "./hud";
import { isPanelOpen, setPanel, togglePanel } from "./layout";
import { closeCopyBox, showPhoto } from "./photo";
import { app } from "./runtime";
import { setPose, setRain } from "./scene";
import { publishScenes, publishWardrobe } from "./sheets";
import { bucketSplash, dryOff, pick, splashAt } from "./splash";
import { state } from "./state";

interface PointerState {
  x: number;
  y: number;
  x0: number;
  y0: number;
  t0: number;
  orbit: boolean;
  pan?: boolean;
}

export const pointers = new Map<number, PointerState>();

function bindPointer() {
  app.canvas.addEventListener("pointerdown", (ev) => {
    app.sound.unlock();
    try {
      app.canvas.setPointerCapture(ev.pointerId);
    } catch {}
    pointers.set(ev.pointerId, {
      x: ev.clientX,
      y: ev.clientY,
      x0: ev.clientX,
      y0: ev.clientY,
      t0: performance.now(),
      orbit: false,
    });
    if (pointers.size === 2) {
      app.pour = null;
      const [a, b] = [...pointers.values()];
      app.pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        dist: orbit.dist,
      };
      return;
    }
    const ptr = pointers.get(ev.pointerId)!;
    if (state.mode === "water" && ev.button === 0) {
      const hit = pick(ev.clientX, ev.clientY);
      if (hit) {
        app.pour = {
          id: ev.pointerId,
          x: ev.clientX,
          y: ev.clientY,
          acc: -0.14,
          pending: hit,
          age: 0,
        };
      } else {
        ptr.orbit = true;
      }
    } else if (ev.button === 1) {
      ptr.pan = true;
    } else {
      ptr.orbit = true;
    }
  });
  app.canvas.addEventListener("mousedown", (ev) => {
    if (ev.button === 1) {
      ev.preventDefault();
    }
  });
  app.canvas.addEventListener("pointermove", (ev) => {
    const ptr = pointers.get(ev.pointerId);
    if (!ptr) {
      return;
    }
    const dx = ev.clientX - ptr.x;
    const dy = ev.clientY - ptr.y;
    ptr.x = ev.clientX;
    ptr.y = ev.clientY;
    if (pointers.size >= 2 && app.pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      orbit.dist = THREE.MathUtils.clamp((app.pinch.dist * app.pinch.d) / Math.max(d, 1), MIN_DIST, MAX_DIST);
      panBy(mx - app.pinch.mx, my - app.pinch.my);
      app.pinch.mx = mx;
      app.pinch.my = my;
      return;
    }
    if (app.pour && app.pour.id === ev.pointerId) {
      app.pour.x = ev.clientX;
      app.pour.y = ev.clientY;
      return;
    }
    if (ptr.pan) {
      panBy(dx, dy);
    } else if (ptr.orbit) {
      orbitBy(dx, dy);
    }
  });
  const onPointerEnd = (ev: PointerEvent) => {
    const ptr = pointers.get(ev.pointerId);
    pointers.delete(ev.pointerId);
    if (app.pour && app.pour.id === ev.pointerId) {
      if (app.pour.pending && pointers.size === 0) {
        splashAt(app.pour.pending);
      }
      app.pour = null;
    }
    if (pointers.size < 2) {
      app.pinch = null;
    }
    if (
      ptr &&
      state.mode === "view" &&
      ev.type === "pointerup" &&
      Math.hypot(ptr.x - ptr.x0, ptr.y - ptr.y0) < 6 &&
      performance.now() - ptr.t0 < 350
    ) {
      const hit = pick(ptr.x, ptr.y);
      if (hit) {
        orbit.target.set(hit.x, hit.y, hit.z);
        orbit.dist = Math.min(orbit.dist, 0.65);
        clampTarget();
      }
    }
  };
  app.canvas.addEventListener("pointerup", onPointerEnd);
  app.canvas.addEventListener("pointercancel", onPointerEnd);
  app.canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
  app.canvas.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      zoomBy(Math.exp(ev.deltaY * 0.0012), ev.deltaY < 0 ? pick(ev.clientX, ev.clientY) : null);
    },
    {
      passive: false,
    },
  );
}

export function bindUi() {
  bindPointer();
  for (const type of ["pointerup", "touchend", "click", "keydown"]) {
    addEventListener(type, () => app.sound.unlock(), {
      capture: true,
      passive: true,
    });
  }
  setMode("water", false);
  showHint("点丝袜任意位置泼水 · 按住拖动连续浇", 0);
  addEventListener(
    "click",
    (ev) => {
      const active = document.activeElement;
      if (ev.detail > 0 && active && active.tagName === "BUTTON") {
        (active as HTMLElement).blur();
      }
    },
    true,
  );
  addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      setPanel(null);
      showPhoto(false);
      closeCopyBox();
      return;
    }
    const tag = (ev.target as Element).tagName;
    if (
      ev.ctrlKey ||
      ev.metaKey ||
      ev.altKey ||
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      isPanelOpen("photo")
    ) {
      return;
    }
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const poseIndex = "1234567".indexOf(key);
    if (key !== " " || tag !== "BUTTON") {
      app.idleTime = 0;
      if (key === " ") {
        ev.preventDefault();
        bucketSplash();
      } else if (poseIndex >= 0 && POSE_ORDER[poseIndex]) {
        setPose(POSE_ORDER[poseIndex]);
      } else if (key === "r") {
        app.sound.unlock();
        setRain(!state.rain);
      } else if (key === "s") {
        toggleSlow();
      } else if (key === "d") {
        dryOff();
      } else if (key === "p") {
        app.photoRequested = true;
      } else if (key === "v") {
        setMode(state.mode === "water" ? "view" : "water");
      } else if (key === "c") {
        togglePanel("scene");
      } else if (key === "w") {
        togglePanel("mat");
      } else if (key === "ArrowLeft" || key === "ArrowRight") {
        ev.preventDefault();
        orbitBy(key === "ArrowLeft" ? 14 : -14, 0);
      } else if (key === "ArrowUp" || key === "ArrowDown") {
        ev.preventDefault();
        orbitBy(0, key === "ArrowUp" ? 16 : -16);
      } else if (key === "+" || key === "=") {
        zoomBy(1 / 1.2);
      } else if (key === "-") {
        zoomBy(1.2);
      } else if (key === "Home" || key === "0") {
        resetView();
      }
    }
  });
  app.uiBound = true;
  publishScenes();
  publishWardrobe();
  app.canvas.addEventListener("pointerdown", () => {
    if (isPanelOpen("about")) {
      setPanel(null);
    }
  });
}
