/**
 * Responsive layout, side panels and the canvas insets they create.
 */
import { ui } from "../../state/ui";
import { app } from "./runtime";
import { $ } from "./dom";
import { refreshThumbs } from "./thumbnails";

/** Panels toggled by setPanel; "photo" is the photo dialog, opened separately. */
export type PanelId = "mat" | "scene" | "about";

export const layout = {
  wide: false,
  roomy: false,
  insetL: 0,
  insetR: 0,
};

export function setPanel(panel: PanelId | null) {
  const cls = document.body.classList;
  if (layout.roomy) {
    if (panel === "mat" || panel === "scene") {
      cls.toggle(panel + "-open");
    }
    cls.toggle("about-open", panel === "about");
  } else {
    for (const p of ["mat", "scene", "about"]) {
      cls.toggle(p + "-open", p === panel);
    }
  }
  syncPanels();
}

export const isPanelOpen = (panel: PanelId | "photo") => document.body.classList.contains(panel + "-open");

export const togglePanel = (panel: PanelId) => setPanel(layout.roomy || !isPanelOpen(panel) ? panel : null);

function syncPanels() {
  const cls = document.body.classList;
  cls.toggle("sheet-open", cls.contains("mat-open") || cls.contains("scene-open"));
  ui.set({
    panels: { mat: cls.contains("mat-open"), scene: cls.contains("scene-open"), about: cls.contains("about-open") },
  });
  updateInsets();
  refreshThumbs();
}

export function applyLayout() {
  const cls = document.body.classList;
  const wasRoomy = layout.roomy;
  layout.wide = app.wideQuery.matches;
  layout.roomy = layout.wide && app.roomyQuery.matches;
  cls.toggle("wide", layout.wide);
  cls.toggle("short", layout.wide && innerHeight < 560);
  cls.toggle("roomy", layout.roomy);
  cls.toggle("fine", app.finePointerQuery.matches);
  if (layout.roomy && !wasRoomy) {
    cls.add("mat-open", "scene-open");
    cls.remove("about-open");
    syncPanels();
  } else if (!layout.roomy && wasRoomy) {
    setPanel(null);
  } else {
    updateInsets();
  }
}

function updateInsets() {
  const cls = document.body.classList;
  let insetL = 0;
  let insetR = 0;
  if (layout.wide) {
    const dock = $(".dock")!;
    const sheet = cls.contains("mat-open") ? $("#materials") : cls.contains("scene-open") ? $("#scenes") : null;
    insetL = dock.offsetLeft + dock.offsetWidth + 10;
    if (sheet) {
      insetR = innerWidth - (layout.roomy ? $(".side")! : sheet).offsetLeft + 10;
    }
  }
  layout.insetL = insetL;
  layout.insetR = insetR;
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--inset-l", insetL + "px");
  rootStyle.setProperty("--stage-x", layout.wide ? insetL + (innerWidth - insetR - insetL) / 2 + "px" : "50%");
}
