/**
 * Development-only hooks for scripted captures.
 */
import { app } from "./runtime";
import { IS_PROD } from "./config";
import { step } from "./loop";

export function installDevHooks() {
  window.__capture = (shotName = "cap") =>
    new Promise((resolve) => {
      app.captureRequest = {
        name: shotName,
        done: resolve,
      };
    });
  window.__advance = (seconds, fps = 60) => {
    for (let i = 0, n = Math.round(seconds * fps); i < n; i++) {
      step(performance.now(), 1 / fps);
    }
  };
  window.__shot = (shotName = "cap") => {
    step(performance.now(), 1 / 60);
    return fetch("/__capture?name=" + shotName, {
      method: "POST",
      body: app.canvas.toDataURL("image/png"),
    });
  };
}
