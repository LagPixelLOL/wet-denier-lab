/**
 * Shared setup for the React UI tests: a mocked actions module, store reset and small DOM queries.
 */
import { act, cleanup } from "@testing-library/react";
import { vi } from "vitest";
import type { actions } from "../../../src/engine/app/actions";
import { initialUiState, ui, type UiState } from "../../../src/state/ui";

type Actions = typeof actions;

// Compile-time exhaustive: adding or removing an action breaks this list.
const ACTION_KEYS = {
  setMode: true,
  toggleAbout: true,
  closeAbout: true,
  toggleWardrobe: true,
  toggleScenes: true,
  bucket: true,
  dry: true,
  toggleRain: true,
  toggleSlow: true,
  toggleSound: true,
  zoomIn: true,
  zoomOut: true,
  resetView: true,
  requestPhoto: true,
  closePhoto: true,
  share: true,
  closeCopyBox: true,
  showTab: true,
  pose: true,
  preset: true,
  previewPreset: true,
  target: true,
  wearChip: true,
  wearColor: true,
  random: true,
  scene: true,
  backdrop: true,
  relayout: true,
} satisfies Record<keyof Actions, true>;

/** Factory for vi.mock of src/engine/app/actions: every action is a bare vi.fn(). */
export function mockActionsModule(): { actions: Actions } {
  const mocked = Object.fromEntries(Object.keys(ACTION_KEYS).map((key) => [key, vi.fn()]));
  return { actions: mocked as unknown as Actions };
}

/** Unmounts rendered trees, restores the initial UI state and clears mock calls. */
export function resetUiTest(): void {
  cleanup();
  ui.set(initialUiState);
  vi.clearAllMocks();
}

/** Writes to the UI store inside act(), as the engine would between frames. */
export function setUi(patch: Partial<UiState> | ((state: UiState) => Partial<UiState>)): void {
  act(() => ui.set(patch));
}

export function setWardrobe(patch: Partial<UiState["wardrobe"]>): void {
  setUi((s) => ({ wardrobe: { ...s.wardrobe, ...patch } }));
}

/** The chip or card with data-v=value inside the group with data-key=group. */
export function chip(group: string, value: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-key="${group}"] > [data-v="${value}"]`);
  if (!el) {
    throw new Error(`no chip ${group}=${value}`);
  }
  return el;
}

export function chips(group: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-key="${group}"] > [data-v]`)];
}

// Chip selection and dimming have no ARIA state; the class list is the only signal.
export const isChipOn = (el: Element): boolean => el.classList.contains("text-on-ink");
export const isChipDimmed = (el: Element): boolean => el.classList.contains("opacity-45");
export const selectedValues = (group: string): string[] =>
  chips(group)
    .filter(isChipOn)
    .map((el) => el.dataset.v!);
