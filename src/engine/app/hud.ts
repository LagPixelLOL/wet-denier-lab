/**
 * Hint bubble and touch mode.
 */
import { app } from "./runtime";
import { $ } from "./dom";
import { state } from "./state";

export function showHint(text, ms = 3200) {
  const hint = $("#hint");
  hint.textContent = text;
  hint.classList.remove("hide");
  clearTimeout(app.hintTimer);
  if (ms) {
    app.hintTimer = setTimeout(() => hint.classList.add("hide"), ms);
  }
}

export function setMode(mode, announce = true) {
  state.mode = mode;
  document.body.classList.toggle("view-mode", mode === "view");
  $("#modeWater").setAttribute("aria-checked", String(mode === "water"));
  $("#modeView").setAttribute("aria-checked", String(mode === "view"));
  app.canvas.style.cursor = mode === "view" ? "grab" : "crosshair";
  if (announce) {
    showHint(
      mode === "view" ? "视角模式：拖动旋转 · 双指或滚轮缩放 · 轻点放大" : "泼水模式：点丝袜泼水 · 按住拖动连续浇",
    );
  }
}
