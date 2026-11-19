/**
 * Entry points for the React UI. They do nothing until the engine has booted and bound the UI.
 */
import { ui, type TouchMode, type WardrobeTab } from "../../state/ui";
import { PRESETS } from "../catalog/presets";
import { resetView, zoomBy } from "./camera";
import { setMode, showHint } from "./hud";
import { applyLayout, isPanelOpen, setPanel, togglePanel } from "./layout";
import { previewPreset, setTargetLeg, wear, wearPreset, wearRandom } from "./outfit";
import { closeCopyBox, shareLook, showPhoto } from "./photo";
import { app } from "./runtime";
import { setBackdrop, setPose, setRain, setScene } from "./scene";
import { publishScenes, publishWardrobe, showWardrobeTab } from "./sheets";
import { bucketSplash, dryOff } from "./splash";
import { state } from "./state";

const bound =
  <A extends unknown[]>(fn: (...args: A) => void) =>
  (...args: A) => {
    if (app.uiBound) {
      fn(...args);
    }
  };

export function toggleSlow() {
  state.slow = !state.slow;
  ui.set({ slow: state.slow });
  if (state.slow) {
    showHint("hint.slow", 2600);
  }
}

/** A wardrobe chip value as rendered in the sheet (data-v), applied to the target leg. */
function wearChip(key: string, value: string) {
  if (key === "denier") {
    wear({
      denier: Number(value),
    });
  } else if (key === "garter") {
    wear(
      value === "1"
        ? {
            garter: true,
            length: "thigh",
          }
        : {
            garter: false,
          },
    );
  } else if (key === "toe") {
    wear({
      toe: value === "1",
    });
  } else if (key === "wetColor") {
    wear({
      wetColor: value || null,
    });
  } else {
    wear({
      [key]: value,
    });
  }
}

export const actions = {
  setMode: bound((mode: TouchMode) => {
    if (state.mode !== mode) {
      setMode(mode);
    }
  }),
  toggleAbout: bound(() => setPanel(isPanelOpen("about") ? null : "about")),
  closeAbout: bound(() => setPanel(null)),
  toggleWardrobe: bound(() => togglePanel("mat")),
  toggleScenes: bound(() => togglePanel("scene")),
  bucket: bound(() => bucketSplash()),
  dry: bound(() => dryOff()),
  toggleRain: bound(() => {
    app.sound.unlock();
    setRain(!state.rain);
  }),
  toggleSlow: bound(toggleSlow),
  /** Re-measures the layout after the UI text changed size (e.g. a new locale). */
  relayout: bound(applyLayout),
  toggleSound: bound(() => {
    app.sound.unlock();
    const on = !ui.get().soundOn;
    ui.set({ soundOn: on });
    app.sound.setEnabled(on);
  }),
  zoomIn: bound(() => zoomBy(1 / 1.25)),
  zoomOut: bound(() => zoomBy(1.25)),
  resetView: bound(() => resetView()),
  requestPhoto: bound(() => {
    app.photoRequested = true;
  }),
  closePhoto: bound(() => showPhoto(false)),
  share: bound(() => shareLook()),
  closeCopyBox,

  showTab: bound((tab: WardrobeTab) => showWardrobeTab(tab)),
  pose: bound((pose: string) => {
    setPose(pose);
    publishWardrobe();
  }),
  preset: bound((index: number) => {
    wearPreset(PRESETS[index]);
    publishWardrobe();
  }),
  previewPreset: bound((index: number | null) => previewPreset(index)),
  target: bound((leg: number) => {
    setTargetLeg(leg);
    publishWardrobe();
  }),
  wearChip: bound((key: string, value: string) => {
    wearChip(key, value);
    publishWardrobe();
  }),
  wearColor: bound((color: string) => {
    wear({
      color,
    });
    publishWardrobe();
  }),
  random: bound(() => {
    wearRandom();
    publishWardrobe();
  }),
  scene: bound((id: string) => {
    setScene(id);
    publishScenes();
  }),
  backdrop: bound((id: string) => {
    setBackdrop(id);
    publishScenes();
  }),
};
