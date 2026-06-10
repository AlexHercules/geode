/**
 * Tiny posix-flavored pure-string shim for the Node `path` module — several
 * community plugin bundles `require("path")` at evaluate time (Obsidian's
 * Electron host provides the real module). Vault paths are always
 * forward-slash, so a posix-only implementation is sufficient. NO node
 * imports — plain string manipulation only.
 */

function normalize(p: string): string {
  if (!p) return ".";
  const isAbs = p.startsWith("/");
  const hadTrailing = p.length > 1 && p.endsWith("/");
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!isAbs) out.push("..");
    } else {
      out.push(part);
    }
  }
  let res = out.join("/");
  if (isAbs) res = `/${res}`;
  if (!res) res = isAbs ? "/" : ".";
  if (hadTrailing && res !== "/" && !res.endsWith("/")) res += "/";
  return res;
}

function join(...paths: string[]): string {
  const joined = paths.filter((s) => s.length > 0).join("/");
  return joined ? normalize(joined) : ".";
}

function dirname(p: string): string {
  if (!p) return ".";
  const stripped = p.length > 1 ? p.replace(/\/+$/, "") : p;
  const idx = stripped.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  return stripped.slice(0, idx);
}

function basename(p: string, ext?: string): string {
  const stripped = p.replace(/\/+$/, "");
  const base = stripped.slice(stripped.lastIndexOf("/") + 1);
  if (ext && base !== ext && base.endsWith(ext)) return base.slice(0, -ext.length);
  return base;
}

function extname(p: string): string {
  const base = basename(p);
  const idx = base.lastIndexOf(".");
  return idx <= 0 ? "" : base.slice(idx);
}

/** Join-like resolution: a later absolute segment restarts the path (no cwd). */
function resolve(...paths: string[]): string {
  let resolved = "";
  for (const p of paths) {
    if (!p) continue;
    resolved = p.startsWith("/") || !resolved ? p : `${resolved}/${p}`;
  }
  return normalize(resolved || ".");
}

/** Minimal relative(): common-prefix strip + '..' for the remaining `from` segments. */
function relative(from: string, to: string): string {
  const f = normalize(from)
    .split("/")
    .filter((s) => s && s !== ".");
  const t = normalize(to)
    .split("/")
    .filter((s) => s && s !== ".");
  let i = 0;
  while (i < f.length && i < t.length && f[i] === t[i]) i++;
  const parts = [...Array<string>(f.length - i).fill(".."), ...t.slice(i)];
  return parts.join("/");
}

function isAbsolute(p: string): boolean {
  return p.startsWith("/");
}

export interface PathShim {
  sep: string;
  delimiter: string;
  normalize: typeof normalize;
  join: typeof join;
  dirname: typeof dirname;
  basename: typeof basename;
  extname: typeof extname;
  resolve: typeof resolve;
  relative: typeof relative;
  isAbsolute: typeof isAbsolute;
  /** self-reference — the shim is posix-flavored on every platform */
  posix: PathShim;
  /** self-reference — vault paths are forward-slash even on Windows */
  win32: PathShim;
}

export const pathShim = {
  sep: "/",
  delimiter: ":",
  normalize,
  join,
  dirname,
  basename,
  extname,
  resolve,
  relative,
  isAbsolute,
} as PathShim;
pathShim.posix = pathShim;
pathShim.win32 = pathShim;
