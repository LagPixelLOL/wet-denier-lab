/**
 * Hint bubble and touch mode.
 */
import type { MessageKey } from "../../i18n";
import { ui, type TouchMode } from "../../state/ui";
import { app } from "./runtime";
import { state } from "./state";

export function showHint(key: MessageKey, ms = 3200) {
  ui.set({ hint: { key, hidden: false } });
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
    showHint(mode === "view" ? "hint.viewMode" : "hint.splashMode");
  }
}
