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
  return (
    <canvas
      id="view"
      className="fixed inset-0 block h-dvh w-screen touch-none opacity-0 transition-opacity duration-900 ease-[ease] ready:opacity-100 scene-out:opacity-0 motion-safe:scene-out:duration-200 motion-safe:scene-in:duration-400 motion-reduce:[transition:none]"
      aria-label="三维丝袜泼水"
    />
  );
}
