import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../../../src/state/createStore";
import { initialUiState, ui } from "../../../src/state/ui";
import { useStore } from "../../../src/state/useStore";

afterEach(() => cleanup());

describe("createStore", () => {
  it("returns the initial state until set", () => {
    const initial = { a: 1, b: "x" };
    const store = createStore(initial);
    expect(store.get()).toBe(initial);
  });

  it("shallow-merges an object patch into a new state object", () => {
    const initial = { a: 1, b: "x" };
    const store = createStore(initial);
    store.set({ a: 2 });
    expect(store.get()).toEqual({ a: 2, b: "x" });
    expect(store.get()).not.toBe(initial);
    expect(initial).toEqual({ a: 1, b: "x" });
  });

  it("passes the current state to a function patch", () => {
    const store = createStore({ count: 1, label: "n" });
    store.set((s) => ({ count: s.count + 10 }));
    store.set((s) => ({ count: s.count * 2 }));
    expect(store.get()).toEqual({ count: 22, label: "n" });
  });

  it("notifies every listener once per set, after the state is updated", () => {
    const store = createStore({ v: 0 });
    const seen: number[] = [];
    const first = vi.fn(() => seen.push(store.get().v));
    const second = vi.fn();
    store.subscribe(first);
    store.subscribe(second);
    store.set({ v: 5 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([5]);
  });

  it("notifies even when the patch is empty", () => {
    const store = createStore({ v: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying a listener after it unsubscribes, leaving the others", () => {
    const store = createStore({ v: 0 });
    const gone = vi.fn();
    const kept = vi.fn();
    const unsubscribe = store.subscribe(gone);
    store.subscribe(kept);
    unsubscribe();
    store.set({ v: 1 });
    expect(gone).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("registers the same listener only once", () => {
    const store = createStore({ v: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.subscribe(listener);
    store.set({ v: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("useStore", () => {
  it("returns the selected slice and re-renders when it changes", () => {
    const store = createStore({ count: 1, other: "a" });
    const { result } = renderHook(() => useStore(store, (s) => s.count));
    expect(result.current).toBe(1);
    act(() => store.set({ count: 7 }));
    expect(result.current).toBe(7);
  });

  it("does not re-render for changes outside the selected slice", () => {
    const store = createStore({ count: 1, other: "a" });
    let renders = 0;
    renderHook(() => {
      renders++;
      return useStore(store, (s) => s.count);
    });
    const before = renders;
    act(() => store.set({ other: "b" }));
    expect(renders).toBe(before);
  });

  it("unsubscribes on unmount", () => {
    const store = createStore({ count: 1 });
    const subscribe = store.subscribe;
    const unsubscribed = vi.fn();
    store.subscribe = (listener) => {
      const off = subscribe(listener);
      return () => {
        unsubscribed();
        off();
      };
    };
    const { unmount } = renderHook(() => useStore(store, (s) => s.count));
    expect(unsubscribed).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });
});

describe("ui store", () => {
  it("starts from initialUiState", () => {
    expect(ui.get()).toBe(initialUiState);
  });

  it("has the documented defaults", () => {
    expect(initialUiState).toMatchObject({
      mode: "water",
      hint: { hidden: false },
      panels: { mat: false, scene: false, about: false },
      rain: false,
      slow: false,
      soundOn: true,
      photo: { open: false, src: null, saveHidden: false },
      copyBox: null,
      bootError: null,
      wardrobe: { tab: "pose", spec: null, pose: "", target: -1, solo: false },
      scenes: { scene: "studio", backdrop: "lilac" },
    });
  });
});
