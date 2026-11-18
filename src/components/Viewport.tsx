import { useEffect } from "react";
import { startApp } from "../engine/app/boot";
import { useT } from "../i18n";

let started = false;

/** The WebGL canvas. The engine attaches to it once, after the first commit. */
export function Viewport() {
  const t = useT();
  useEffect(() => {
    if (started) return;
    started = true;
    startApp();
  }, []);
  return (
    <canvas
      id="view"
      className="fixed inset-0 block h-dvh w-screen touch-none opacity-0 transition-opacity duration-900 ease-[ease] motion-reduce:[transition:none] ready:opacity-100 scene-out:opacity-0 motion-safe:scene-out:duration-200 motion-safe:scene-in:duration-400"
      aria-label={t("viewport.label")}
    />
  );
}
