import { useSyncExternalStore } from "react";
import type { Store } from "./createStore";

/** Subscribes a component to a slice of a store. The selector must return a stable value for unchanged state. */
export function useStore<T, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
