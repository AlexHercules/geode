/**
 * R258: ES5/tslib `__extends` interop for the obsidian base classes.
 *
 * Real community plugins compiled to **ES5 with tslib** (e.g. Sort & Permute lines
 * 0.7.0) inherit from the obsidian base classes by calling `Base.apply(this, args)`
 * inside the derived constructor:
 *
 *     function MyPlugin() { return _super.apply(this, arguments) || this; }   // _super = obsidian.Plugin
 *
 * The shim's base classes are ES6 `class`es, which throw
 * "Class constructor X cannot be invoked without 'new'" when called via `.apply`/`.call`.
 * `es5Callable(Base)` returns a transparent Proxy that adds an `apply` trap: it
 * constructs a real instance and copies its own fields onto the already-prototyped
 * `this` (tslib's `__extends` has already set `MyPlugin.prototype`'s chain to include
 * `Base.prototype`), mirroring what running the ES6 constructor body would have done.
 *
 * Untouched paths: `new Base()` and `super()` (modern ES6-target plugins) forward
 * through the Proxy's default [[Construct]]; every other operation (statics, prototype,
 * instanceof via getPrototypeOf) forwards to the target, so identity is preserved both
 * ways (`x instanceof RawBase` and `x instanceof WrappedBase` both hold).
 *
 * Caveat — the apply path harvests a THROWAWAY instance's fields, which copies cleanly
 * ONLY when the base's constructor state is plain fields. It is INCORRECT for a base
 * whose constructor binds `this`-capturing closures or registers listeners on external
 * elements: the copied references stay bound to the discarded throwaway, so the live
 * `this` is silently inert. Therefore the caller (loader.ts) wraps ONLY throwaway-safe
 * bases — field-init (Plugin / Component / MarkdownRenderChild / PluginSettingTab) and
 * detached-DOM-in-fields (View / ItemView / FileView). Bases with ctor-time
 * `this`-capturing listeners (Modal / SuggestModal / FuzzySuggestModal / EditorSuggest /
 * AbstractInputSuggest) are deliberately NOT wrapped: an ES5/tslib plugin extending them
 * hard-fails to load with a clear (getLastError-surfaced) error rather than loading a
 * broken instance — pending a future round that defers their ctor listener-registration.
 */
type AnyAbstractCtor = abstract new (...args: never[]) => object;

export function es5Callable<T extends AnyAbstractCtor>(Base: T): T {
  return new Proxy(Base, {
    apply(target, thisArg, argList) {
      // tslib: `Base.apply(this, arguments)` — construct a real instance and graft
      // its own (enumerable) fields onto `this`, then return `this` (the `|| this`
      // in the compiled derived ctor expects a truthy return).
      const Ctor = target as unknown as new (...args: unknown[]) => object;
      Object.assign(thisArg as object, new Ctor(...argList));
      return thisArg as object;
    },
  }) as T;
}
