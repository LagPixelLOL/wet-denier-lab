/**
 * View state for the React UI. The engine writes it; components render it and call engine actions.
 */
import type { LegSpec } from "../engine/catalog/presets";
import { createStore } from "./createStore";

export type TouchMode = "water" | "view";
export type WardrobeTab = "pose" | "preset" | "style" | "color" | "material" | "pattern" | "fun";

/** The subset of a leg spec the wardrobe sheet displays. */
export type WardrobeSpec = Pick<
  LegSpec,
  "length" | "cuff" | "garter" | "color" | "material" | "denier" | "pattern" | "secret" | "wetColor"
>;

export interface UiState {
  mode: TouchMode;
  hint: { text: string; hidden: boolean };
  panels: { mat: boolean; scene: boolean; about: boolean };
  rain: boolean;
  rainLabel: string;
  slow: boolean;
  soundOn: boolean;
  photo: { open: boolean; src: string | null; tip: string; saveHidden: boolean };
  /** Fallback when the clipboard is unavailable; null until first needed. */
  copyBox: { url: string; open: boolean } | null;
  bootError: string | null;
  wardrobe: { tab: WardrobeTab; spec: WardrobeSpec | null; pose: string; target: number; solo: boolean };
  scenes: { scene: string; backdrop: string };
}

export const initialUiState: UiState = {
  mode: "water",
  hint: { text: "点丝袜任意位置泼水 · 按住拖动连续浇", hidden: false },
  panels: { mat: false, scene: false, about: false },
  rain: false,
  rainLabel: "细雨",
  slow: false,
  soundOn: true,
  photo: { open: false, src: null, tip: "长按图片可以保存", saveHidden: false },
  copyBox: null,
  bootError: null,
  wardrobe: { tab: "pose", spec: null, pose: "", target: -1, solo: false },
  scenes: { scene: "studio", backdrop: "lilac" },
};

export const ui = createStore<UiState>(initialUiState);
