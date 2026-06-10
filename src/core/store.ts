import { useSyncExternalStore } from "react";

/** Minimal observable store. All shared app state lives in Store instances. */
export class Store<T> {
  private value: T;
  private listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(next: T) {
    if (Object.is(next, this.value)) return;
    this.value = next;
    this.listeners.forEach((l) => l());
  }

  update(fn: (prev: T) => T) {
    this.set(fn(this.value));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** React hook: subscribe to a Store and re-render on change. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, () => store.get(), () => store.get());
}
