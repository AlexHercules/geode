/**
 * R261: obsidian `parseYaml` / `stringifyYaml` — thin wrappers over js-yaml (the same
 * library Obsidian itself uses). These back the general-purpose YAML the Dataview /
 * Templater / QuickAdd / Tasks plugin class reads (inline fields, arbitrary frontmatter,
 * nested maps, multi-doc) — which `core/properties.ts` (a deliberately-frozen
 * frontmatter-SUBSET parser) cannot faithfully cover.
 *
 * js-yaml@^4 is the single new runtime dependency authorized for this track (hard
 * boundary #5, R260 user decision — only this package, only for parseYaml/stringifyYaml).
 *
 * d.ts: `parseYaml(yaml: string): any` / `stringifyYaml(obj: any): string`. We use the
 * stricter `unknown` internally (CLAUDE.md: no `any`); plugins still compile against the
 * d.ts `any` (they consume obsidian.d.ts, not Geode's types).
 */
import { dump, load } from "js-yaml";

/** Parse a YAML string to its JS value (js-yaml.load), matching obsidian.parseYaml. */
export function parseYaml(yaml: string): unknown {
  return load(yaml);
}

/** Serialize a JS value to a YAML string (js-yaml.dump), matching obsidian.stringifyYaml. */
export function stringifyYaml(obj: unknown): string {
  return dump(obj);
}
