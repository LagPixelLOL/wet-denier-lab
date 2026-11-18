/**
 * App-wide interaction state and the current outfit.
 */
import { withLegDefaults } from "../catalog/presets";

export const state = {
  mode: "water",
  slow: false,
  rain: false,
  splashes: 0,
  scene: "studio",
  backdrop: "lilac",
};

export const outfit = {
  legs: [withLegDefaults({}), withLegDefaults({})],
  target: -1,
};
