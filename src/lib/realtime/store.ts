"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A ~40-line external store, used instead of a global state library.
 *
 * The reason it exists at all: the needle broadcasts at roughly 20 Hz while
 * being dragged. Holding that in ordinary React state would re-render the
 * scoreboard, the clue and every panel twenty times a second. With
 * `useSyncExternalStore`, only the components that subscribe to the needle
 * slice re-render, and everything else stays still.
 *
 * Redux would be overkill for this, and Zustand would be a dependency for
 * something React already does.
 */
export interface Store<T> {
  get(): T;
  set(next: T | ((current: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => value,
    set(next) {
      const resolved =
        typeof next === "function" ? (next as (current: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: Store<T>): T;
export function useStore<T, S>(store: Store<T>, selector: (value: T) => S): S;
export function useStore<T, S>(store: Store<T>, selector?: (value: T) => S): T | S {
  const getSnapshot = useCallback(
    () => (selector === undefined ? store.get() : selector(store.get())),
    [store, selector],
  );
  // Server snapshot is the same: these stores are hydrated from props, so
  // there is nothing browser-specific in the initial value.
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
