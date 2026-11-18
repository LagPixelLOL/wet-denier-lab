import { useEffect } from "react";
import { startApp } from "../engine/app/boot";

let started = false;

/** The WebGL canvas. The engine attaches to it once, after the first commit. */
export function Viewport() {
  useEffect(() => {
    if (started) return;
    started = true;
    startApp();
  }, []);
  return <canvas id="view" aria-label="三维丝袜泼水" />;
}
