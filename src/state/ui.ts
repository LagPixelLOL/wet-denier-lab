/**
 * View state for the React UI. The engine writes it; components render it and call engine actions.
 */
import type { LegSpec } from "../engine/catalog/presets";
import type { MessageKey } from "../i18n";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locales";
import { createStore } from "./createStore";

export type TouchMode = "water" | "view";
export type WardrobeTab = "pose" | "preset" | "style" | "color" | "material" | "pattern" | "fun";

/** The subset of a leg spec the wardrobe sheet displays. */
export type WardrobeSpec = Pick<
  LegSpec,
  "length" | "cuff" | "garter" | "toe" | "color" | "material" | "denier" | "pattern" | "secret" | "wetColor"
>;

export interface UiState {
  locale: Locale;
  mode: TouchMode;
  /** Text shown as message keys, so it follows locale changes. */
  hint: { key: MessageKey; hidden: boolean };
  panels: { mat: boolean; scene: boolean; about: boolean };
  rain: boolean;
  rainLabel: MessageKey;
  slow: boolean;
  soundOn: boolean;
  photo: { open: boolean; src: string | null; tip: MessageKey; saveHidden: boolean };
  /** Fallback when the clipboard is unavailable; null until first needed. */
  copyBox: { url: string; open: boolean } | null;
  bootError: string | null;
  wardrobe: { tab: WardrobeTab; spec: WardrobeSpec | null; pose: string; target: number; solo: boolean };
  scenes: { scene: string; backdrop: string };
}

export const initialUiState: UiState = {
  locale: DEFAULT_LOCALE,
  mode: "water",
  hint: { key: "hint.start", hidden: false },
  panels: { mat: false, scene: false, about: false },
  rain: false,
  rainLabel: "scene.studio.rain",
  slow: false,
  soundOn: true,
  photo: { open: false, src: null, tip: "photo.tip.mobile", saveHidden: false },
  copyBox: null,
  bootError: null,
  wardrobe: { tab: "pose", spec: null, pose: "", target: -1, solo: false },
  scenes: { scene: "studio", backdrop: "lilac" },
};

export const ui = createStore<UiState>(initialUiState);
