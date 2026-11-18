/**
 * App-wide interaction state and the current outfit.
 */
import type { TouchMode } from "../../state/ui";
import { withLegDefaults, type LegSpec } from "../catalog/presets";

export interface AppState {
  mode: TouchMode;
  slow: boolean;
  rain: boolean;
  splashes: number;
  /** Scene key (always a known scene). */
  scene: string;
  /** Backdrop key or custom "#rrggbb". */
  backdrop: string;
}

export interface Outfit {
  /** [left, right] */
  legs: LegSpec[];
  /** Leg the wardrobe edits: 0, 1, or -1 for both. */
  target: number;
}

export const state: AppState = {
  mode: "water",
  slow: false,
  rain: false,
  splashes: 0,
  scene: "studio",
  backdrop: "lilac",
};

export const outfit: Outfit = {
  legs: [withLegDefaults({}), withLegDefaults({})],
  target: -1,
};
