/**
 * Publishes the wardrobe and scene sheet state to the UI store.
 */
import { ui, type WardrobeTab } from "../../state/ui";
import { app } from "./runtime";
import { outfit, state } from "./state";
import { refreshThumbs } from "./thumbnails";

export function publishWardrobe() {
  if (!app.uiBound) {
    return;
  }
  const solo = app.rig.solo;
  const spec = outfit.legs[outfit.target === 1 && !solo ? 1 : 0];
  ui.set((s) => ({
    wardrobe: {
      ...s.wardrobe,
      spec: {
        length: spec.length,
        cuff: spec.cuff,
        garter: spec.garter,
        toe: spec.toe,
        color: spec.color,
        material: spec.material,
        denier: spec.denier,
        pattern: spec.pattern,
        secret: spec.secret,
        wetColor: spec.wetColor,
      },
      pose: app.rig.name,
      target: outfit.target,
      solo,
    },
  }));
}

export function publishScenes() {
  if (!app.uiBound) {
    return;
  }
  ui.set({ scenes: { scene: state.scene, backdrop: state.backdrop } });
}

export function showWardrobeTab(tab: WardrobeTab) {
  ui.set((s) => ({ wardrobe: { ...s.wardrobe, tab } }));
  refreshThumbs();
}
