/**
 * Hint bubble and touch mode.
 */
import { ui, type TouchMode } from "../../state/ui";
import { app } from "./runtime";
import { state } from "./state";

export function showHint(text: string, ms = 3200) {
  ui.set({ hint: { text, hidden: false } });
  clearTimeout(app.hintTimer);
  if (ms) {
    app.hintTimer = setTimeout(hideHint, ms);
  }
}

export function hideHint() {
  ui.set((s) => ({ hint: { ...s.hint, hidden: true } }));
}

export function setMode(mode: TouchMode, announce = true) {
  state.mode = mode;
  document.body.classList.toggle("view-mode", mode === "view");
  ui.set({ mode });
  app.canvas.style.cursor = mode === "view" ? "grab" : "crosshair";
  if (announce) {
    showHint(
      mode === "view" ? "视角模式：拖动旋转 · 双指或滚轮缩放 · 轻点放大" : "泼水模式：点丝袜泼水 · 按住拖动连续浇",
    );
  }
}
