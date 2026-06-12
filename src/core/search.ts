/**
 * Search query parser + evaluator (R21 frozen contract).
 *
 * Grammar (hand-written tokenizer + recursive descent, zero dependencies):
 *   query   := or
 *   or      := and ("OR" and)*            // bare token exactly uppercase "OR"
 *   and     := unary+                     // implicit AND; "-" > AND > OR
 *   unary   := "-" unary | primary        // "-" must touch the next element
 *   primary := "(" or ")" | "..." | /regex/flags | operator operand | word
 *
 * Operators (lowercase only): file: path: content: tag: line: match-case:
 * ignore-case:. The operand is the single token (word / phrase / regex) or
 * paren group glued to the colon; an empty operand degrades the whole token
 * to a literal word. Field operators rebind only default-field terms inside
 * a group operand; explicit operators inside keep their own field.
 */

export type CaseMode = "default" | "sensitive" | "insensitive";

export type SearchMatcher =
  | { kind: "text"; text: string; caseMode: CaseMode }
  | { kind: "regex"; source: string; flags: string };

export type SearchField = "content" | "file" | "path" | "tag";

export type SearchExpr =
  | { type: "and"; children: SearchExpr[] }
  | { type: "or"; children: SearchExpr[] }
  | { type: "not"; child: SearchExpr }
  | { type: "term"; field: SearchField | "default"; matcher: SearchMatcher }
  | { type: "line"; child: SearchExpr };

export type SearchParseErrorCode =
  | "bad-regex"
  | "unclosed-quote"
  | "unclosed-paren"
  | "empty-query-group";

export interface ParsedSearch {
  expr: SearchExpr | null;
  error: { code: SearchParseErrorCode; detail?: string } | null;
}

export interface SearchInput {
  path: string;
  fileName: string;
  basename: string;
  content: string;
  tags: readonly string[];
}

export interface SearchMatchRange {
  from: number;
  to: number;
}

export interface SearchOutcome {
  matched: boolean;
  /** content-anchored positive match ranges (sorted, overlaps merged) */
  ranges: SearchMatchRange[];
  /** basename match ranges (default/file fields) for file-name highlighting */
  nameRanges: SearchMatchRange[];
}

// ---------------------------------------------------------------------------
// Parser

const OPERATOR_RE = /^(file|path|content|tag|line|match-case|ignore-case):/;
const REGEX_FLAGS = "imsu";

class ParseFailure extends Error {
  constructor(
    readonly code: SearchParseErrorCode,
    readonly detail?: string,
  ) {
    super(code);
  }
}

export function parseSearchQuery(raw: string): ParsedSearch {
  try {
    return { expr: new Parser(raw).parse(), error: null };
  } catch (e) {
    if (e instanceof ParseFailure) {
      return { expr: null, error: { code: e.code, detail: e.detail } };
    }
    throw e;
  }
}

function textTerm(field: SearchField | "default", text: string): SearchExpr {
  return { type: "term", field, matcher: { kind: "text", text, caseMode: "default" } };
}

class Parser {
  private pos = 0;

  constructor(private readonly s: string) {}

  parse(): SearchExpr | null {
    const expr = this.parseOr();
    this.skipWs();
    // parseOr only stops before ")" or EOF, so any leftover is a stray ")"
    if (this.pos < this.s.length) {
      throw new ParseFailure("unclosed-paren", `unexpected ")" at offset ${this.pos}`);
    }
    return expr;
  }

  private isWs(c: string): boolean {
    return /\s/.test(c);
  }

  private skipWs(): void {
    while (this.pos < this.s.length && this.isWs(this.s[this.pos])) this.pos++;
  }

  /** End of a bare token starting at `from` (stops at whitespace and structure). */
  private wordEnd(from: number): number {
    let i = from;
    while (i < this.s.length) {
      const c = this.s[i];
      if (this.isWs(c) || c === "(" || c === ")" || c === '"') break;
      i++;
    }
    return i;
  }

  private peekIsOr(): boolean {
    return this.s.slice(this.pos, this.wordEnd(this.pos)) === "OR";
  }

  private parseOr(): SearchExpr | null {
    const children: SearchExpr[] = [];
    for (;;) {
      const node = this.parseAnd();
      if (node) children.push(node);
      this.skipWs();
      if (this.pos < this.s.length && this.peekIsOr()) {
        this.pos += 2; // "OR"
        continue;
      }
      break;
    }
    if (children.length === 0) return null;
    return children.length === 1 ? children[0] : { type: "or", children };
  }

  private parseAnd(): SearchExpr | null {
    const children: SearchExpr[] = [];
    for (;;) {
      this.skipWs();
      if (this.pos >= this.s.length || this.s[this.pos] === ")") break;
      if (this.peekIsOr()) break;
      children.push(this.parseUnary());
    }
    if (children.length === 0) return null;
    return children.length === 1 ? children[0] : { type: "and", children };
  }

  private parseUnary(): SearchExpr {
    if (this.s[this.pos] === "-") {
      const next = this.s[this.pos + 1];
      // "-" negates only when glued to the next element; otherwise literal
      if (next !== undefined && !this.isWs(next) && next !== ")") {
        this.pos++;
        return { type: "not", child: this.parseUnary() };
      }
    }
    return this.parsePrimary();
  }

  private parsePrimary(): SearchExpr {
    const c = this.s[this.pos];
    if (c === "(") return this.parseGroup();
    if (c === '"') return textTerm("default", this.parseQuoted());
    if (c === "/") return { type: "term", field: "default", matcher: this.parseRegex() };
    const op = OPERATOR_RE.exec(this.s.slice(this.pos));
    if (op) return this.parseOperator(op[1], op[0].length);
    return this.parseBareWord();
  }

  private parseGroup(): SearchExpr {
    this.pos++; // "("
    const expr = this.parseOr();
    this.skipWs();
    if (this.pos >= this.s.length) throw new ParseFailure("unclosed-paren");
    this.pos++; // ")"
    if (!expr) throw new ParseFailure("empty-query-group");
    return expr;
  }

  private parseQuoted(): string {
    this.pos++; // '"'
    let out = "";
    while (this.pos < this.s.length) {
      const c = this.s[this.pos];
      if (c === "\\" && this.s[this.pos + 1] === '"') {
        out += '"';
        this.pos += 2;
        continue;
      }
      if (c === '"') {
        this.pos++;
        return out;
      }
      out += c;
      this.pos++;
    }
    throw new ParseFailure("unclosed-quote");
  }

  private parseRegex(): SearchMatcher {
    this.pos++; // "/"
    let source = "";
    let closed = false;
    while (this.pos < this.s.length) {
      const c = this.s[this.pos];
      if (c === "\\" && this.pos + 1 < this.s.length) {
        source += c + this.s[this.pos + 1]; // keep escapes verbatim (incl. "\/")
        this.pos += 2;
        continue;
      }
      if (c === "/") {
        this.pos++;
        closed = true;
        break;
      }
      source += c;
      this.pos++;
    }
    if (!closed) throw new ParseFailure("bad-regex", "unterminated regex literal");
    let flags = "";
    while (this.pos < this.s.length && /[a-z]/i.test(this.s[this.pos])) {
      flags += this.s[this.pos];
      this.pos++;
    }
    for (const f of flags) {
      if (!REGEX_FLAGS.includes(f)) {
        throw new ParseFailure("bad-regex", `unsupported flag "${f}"`);
      }
    }
    try {
      new RegExp(source, flags);
    } catch (e) {
      throw new ParseFailure("bad-regex", e instanceof Error ? e.message : String(e));
    }
    return { kind: "regex", source, flags };
  }

  private parseOperator(name: string, prefixLen: number): SearchExpr {
    this.pos += prefixLen;
    const c = this.s[this.pos];
    if (c === undefined || this.isWs(c) || c === ")") {
      // empty operand: the whole token degrades to a literal word
      return textTerm("default", `${name}:`);
    }
    const fieldOp = name === "file" || name === "path" || name === "content" || name === "tag";
    // Field operators bind a single-token bare word literally — no "#" tag
    // sugar, so `content:#todo` searches the literal text instead of being
    // silently rewritten to a tag term. Groups/quotes/regexes and the
    // case/line operators keep the regular parse.
    let operand: SearchExpr;
    if (fieldOp && c !== "(" && c !== '"' && c !== "/") {
      const end = this.wordEnd(this.pos);
      operand = textTerm("default", this.s.slice(this.pos, end));
      this.pos = end;
    } else {
      operand = this.parsePrimary();
    }
    switch (name) {
      case "line":
        return { type: "line", child: operand };
      case "match-case":
        return rebindCase(operand, "sensitive");
      case "ignore-case":
        return rebindCase(operand, "insensitive");
      default:
        return rebindField(operand, name as SearchField);
    }
  }

  private parseBareWord(): SearchExpr {
    const end = this.wordEnd(this.pos);
    const word = this.s.slice(this.pos, end);
    this.pos = end;
    if (word.startsWith("#") && word.length > 1) return textTerm("tag", word.slice(1));
    return textTerm("default", word);
  }
}

/** Rebind default-field terms (recursively) to an explicit field. */
function rebindField(expr: SearchExpr, field: SearchField): SearchExpr {
  switch (expr.type) {
    case "term":
      if (expr.field === "default") {
        expr.field = field;
        if (field === "tag" && expr.matcher.kind === "text" && expr.matcher.text.startsWith("#")) {
          expr.matcher.text = expr.matcher.text.slice(1);
        }
      }
      return expr;
    case "not":
    case "line":
      rebindField(expr.child, field);
      return expr;
    default:
      for (const child of expr.children) rebindField(child, field);
      return expr;
  }
}

/** Rebind case mode of every matcher (regex: strip/add the "i" flag). */
function rebindCase(expr: SearchExpr, mode: "sensitive" | "insensitive"): SearchExpr {
  switch (expr.type) {
    case "term": {
      const m = expr.matcher;
      if (m.kind === "text") m.caseMode = mode;
      else if (mode === "sensitive") m.flags = m.flags.replace(/i/g, "");
      else if (!m.flags.includes("i")) m.flags += "i";
      return expr;
    }
    case "not":
    case "line":
      rebindCase(expr.child, mode);
      return expr;
    default:
      for (const child of expr.children) rebindCase(child, mode);
      return expr;
  }
}

// ---------------------------------------------------------------------------
// Evaluator

interface NodeResult {
  matched: boolean;
  ranges: SearchMatchRange[];
  nameRanges: SearchMatchRange[];
}

/** The content slice a subtree is evaluated against (full file or one line). */
interface Scope {
  text: string;
  /** offset of `text` within the full content (ranges stay content-anchored) */
  offset: number;
  isLine: boolean;
  lower: LoweredText | null; // lazy, computed at most once per scope
  lines: Scope[] | null; // lazy, split at most once per scope
}

/**
 * Lowercased haystack plus index maps back to the original string for the
 * rare case where toLowerCase changes the length (U+0130 "İ" → "i̇") — match
 * ranges must stay anchored to the ORIGINAL text. Maps are null in the
 * common same-length case.
 */
interface LoweredText {
  hay: string;
  starts: Int32Array | null; // lowered index -> original start
  ends: Int32Array | null; // lowered index -> original end (exclusive)
}

function lowerText(text: string): LoweredText {
  const hay = text.toLowerCase();
  if (hay.length === text.length) return { hay, starts: null, ends: null };
  const starts = new Int32Array(hay.length);
  const ends = new Int32Array(hay.length);
  let li = 0;
  let i = 0;
  for (const ch of text) {
    // only per-code-point WIDTHS are needed here; `hay` itself keeps the
    // whole-string (context-aware) lowering
    const w = ch.toLowerCase().length;
    for (let k = 0; k < w && li < hay.length; k++) {
      starts[li] = i;
      ends[li] = i + ch.length;
      li++;
    }
    i += ch.length;
  }
  for (; li < hay.length; li++) {
    starts[li] = text.length;
    ends[li] = text.length;
  }
  return { hay, starts, ends };
}

type NameKey = "basename" | "fileName" | "path";
type TextMatcher = Extract<SearchMatcher, { kind: "text" }>;
type RegexMatcher = Extract<SearchMatcher, { kind: "regex" }>;
type TermExpr = Extract<SearchExpr, { type: "term" }>;

/** Per-evaluateSearch-call caches (one input file per call). */
interface EvalCtx {
  input: SearchInput;
  lowerNames: Map<NameKey, LoweredText>;
  lowerTags: readonly string[] | null;
  regexes: Map<SearchMatcher, RegExp>; // compiled once, "g" appended
  lowerNeedles: Map<SearchMatcher, string>;
}

const NO_RANGES: SearchMatchRange[] = [];
const NO_MATCH: NodeResult = { matched: false, ranges: NO_RANGES, nameRanges: NO_RANGES };
const MATCH_NO_RANGES: NodeResult = { matched: true, ranges: NO_RANGES, nameRanges: NO_RANGES };

export function evaluateSearch(expr: SearchExpr, input: SearchInput): SearchOutcome {
  const ctx: EvalCtx = {
    input,
    lowerNames: new Map(),
    lowerTags: null,
    regexes: new Map(),
    lowerNeedles: new Map(),
  };
  const scope: Scope = { text: input.content, offset: 0, isLine: false, lower: null, lines: null };
  const r = evalExpr(expr, ctx, scope, true);
  if (!r.matched) return { matched: false, ranges: [], nameRanges: [] };
  return { matched: true, ranges: mergeRanges(r.ranges), nameRanges: mergeRanges(r.nameRanges) };
}

/** `collect=false` = boolean-only evaluation (under `not`, ranges are discarded). */
function evalExpr(expr: SearchExpr, ctx: EvalCtx, scope: Scope, collect: boolean): NodeResult {
  switch (expr.type) {
    case "and": {
      const ranges: SearchMatchRange[] = [];
      const nameRanges: SearchMatchRange[] = [];
      for (const child of expr.children) {
        const r = evalExpr(child, ctx, scope, collect);
        if (!r.matched) return NO_MATCH;
        ranges.push(...r.ranges);
        nameRanges.push(...r.nameRanges);
      }
      return { matched: true, ranges, nameRanges };
    }
    case "or": {
      // all matched branches contribute ranges; unmatched branches contribute none
      let matched = false;
      const ranges: SearchMatchRange[] = [];
      const nameRanges: SearchMatchRange[] = [];
      for (const child of expr.children) {
        const r = evalExpr(child, ctx, scope, collect);
        if (!r.matched) continue;
        matched = true;
        if (!collect) break;
        ranges.push(...r.ranges);
        nameRanges.push(...r.nameRanges);
      }
      return matched ? { matched: true, ranges, nameRanges } : NO_MATCH;
    }
    case "not": {
      const r = evalExpr(expr.child, ctx, scope, false);
      return r.matched ? NO_MATCH : MATCH_NO_RANGES;
    }
    case "line": {
      if (!scope.lines) scope.lines = splitLines(scope);
      let matched = false;
      const ranges: SearchMatchRange[] = [];
      const nameRanges: SearchMatchRange[] = [];
      for (const line of scope.lines) {
        const r = evalExpr(expr.child, ctx, line, collect);
        if (!r.matched) continue;
        matched = true;
        if (!collect) break;
        ranges.push(...r.ranges);
        nameRanges.push(...r.nameRanges);
      }
      return matched ? { matched: true, ranges, nameRanges } : NO_MATCH;
    }
    case "term":
      return evalTerm(expr, ctx, scope, collect);
  }
}

function evalTerm(term: TermExpr, ctx: EvalCtx, scope: Scope, collect: boolean): NodeResult {
  const matcher = term.matcher;
  switch (term.field) {
    case "content": {
      const r = matchContent(matcher, ctx, scope, collect);
      return r.matched ? { matched: true, ranges: r.ranges, nameRanges: NO_RANGES } : NO_MATCH;
    }
    case "default": {
      // default = content ∪ basename. The basename side is skipped inside
      // line: scopes so the same-line constraint stays meaningful.
      const content = matchContent(matcher, ctx, scope, collect);
      const name = scope.isLine
        ? { matched: false, ranges: NO_RANGES }
        : matchName(matcher, ctx, "basename", collect);
      if (!content.matched && !name.matched) return NO_MATCH;
      return {
        matched: true,
        ranges: content.matched ? content.ranges : NO_RANGES,
        nameRanges: name.matched ? name.ranges : NO_RANGES,
      };
    }
    case "file": {
      const r = matchName(matcher, ctx, "fileName", collect);
      if (!r.matched) return NO_MATCH;
      return {
        matched: true,
        ranges: NO_RANGES,
        nameRanges: clampToBasename(r.ranges, ctx.input.basename.length),
      };
    }
    case "path":
      return matchName(matcher, ctx, "path", false).matched ? MATCH_NO_RANGES : NO_MATCH;
    case "tag":
      return matchTags(matcher, ctx) ? MATCH_NO_RANGES : NO_MATCH;
  }
}

function matchContent(
  matcher: SearchMatcher,
  ctx: EvalCtx,
  scope: Scope,
  collect: boolean,
): { matched: boolean; ranges: SearchMatchRange[] } {
  if (matcher.kind === "text") {
    if (matcher.caseMode === "sensitive") {
      return textScan(scope.text, matcher.text, scope.offset, collect);
    }
    const lo = (scope.lower ??= lowerText(scope.text));
    return textScan(lo.hay, lowerNeedle(ctx, matcher), scope.offset, collect, lo.starts, lo.ends);
  }
  return regexScan(getRegex(ctx, matcher), scope.text, scope.offset, collect);
}

function matchName(
  matcher: SearchMatcher,
  ctx: EvalCtx,
  key: NameKey,
  collect: boolean,
): { matched: boolean; ranges: SearchMatchRange[] } {
  if (matcher.kind === "text") {
    if (matcher.caseMode === "sensitive") {
      return textScan(ctx.input[key], matcher.text, 0, collect);
    }
    const lo = lowerName(ctx, key);
    return textScan(lo.hay, lowerNeedle(ctx, matcher), 0, collect, lo.starts, lo.ends);
  }
  return regexScan(getRegex(ctx, matcher), ctx.input[key], 0, collect);
}

function matchTags(matcher: SearchMatcher, ctx: EvalCtx): boolean {
  if (matcher.kind === "regex") {
    const re = getRegex(ctx, matcher);
    for (const tag of ctx.input.tags) {
      re.lastIndex = 0;
      if (re.test(tag)) return true;
    }
    return false;
  }
  const sensitive = matcher.caseMode === "sensitive";
  const needle = sensitive ? matcher.text : lowerNeedle(ctx, matcher);
  if (needle.length === 0) return false;
  const tags = sensitive ? ctx.input.tags : lowerTags(ctx);
  // exact tag, or prefix at a "/" boundary (tag:work hits work/phone, not workshop)
  for (const tag of tags) {
    if (tag === needle || (tag.startsWith(needle) && tag[needle.length] === "/")) return true;
  }
  return false;
}

function textScan(
  hay: string,
  needle: string,
  offset: number,
  collect: boolean,
  starts: Int32Array | null = null,
  ends: Int32Array | null = null,
): { matched: boolean; ranges: SearchMatchRange[] } {
  if (needle.length === 0) return { matched: true, ranges: [] };
  let idx = hay.indexOf(needle);
  if (idx === -1) return { matched: false, ranges: [] };
  const ranges: SearchMatchRange[] = [];
  while (idx !== -1) {
    const last = idx + needle.length - 1;
    ranges.push({
      from: offset + (starts ? starts[idx] : idx),
      to: offset + (ends ? ends[last] : idx + needle.length),
    });
    if (!collect) break;
    idx = hay.indexOf(needle, idx + needle.length);
  }
  return { matched: true, ranges };
}

function regexScan(
  re: RegExp,
  hay: string,
  offset: number,
  collect: boolean,
): { matched: boolean; ranges: SearchMatchRange[] } {
  const ranges: SearchMatchRange[] = [];
  let matched = false;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay)) !== null) {
    matched = true;
    const len = m[0].length;
    if (len > 0) ranges.push({ from: offset + m.index, to: offset + m.index + len });
    if (!collect) break;
    if (len === 0) {
      // zero-length match: step forward to avoid an infinite loop. Step over
      // a full surrogate pair — with /u, a mid-pair lastIndex snaps back to
      // the pair start and the same zero-length match would repeat forever.
      const cc = hay.charCodeAt(m.index);
      re.lastIndex = m.index + (cc >= 0xd800 && cc <= 0xdbff ? 2 : 1);
      if (re.lastIndex > hay.length) break;
    }
  }
  return { matched, ranges };
}

function splitLines(scope: Scope): Scope[] {
  const out: Scope[] = [];
  const text = scope.text;
  let start = 0;
  for (;;) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    let sliceEnd = end;
    if (sliceEnd > start && text[sliceEnd - 1] === "\r") sliceEnd--;
    out.push({
      text: text.slice(start, sliceEnd),
      offset: scope.offset + start,
      isLine: true,
      lower: null,
      lines: null,
    });
    if (end >= text.length) break;
    start = end + 1;
  }
  return out;
}

function lowerName(ctx: EvalCtx, key: NameKey): LoweredText {
  let v = ctx.lowerNames.get(key);
  if (v === undefined) {
    v = lowerText(ctx.input[key]);
    ctx.lowerNames.set(key, v);
  }
  return v;
}

function lowerTags(ctx: EvalCtx): readonly string[] {
  return (ctx.lowerTags ??= ctx.input.tags.map((t) => t.toLowerCase()));
}

function lowerNeedle(ctx: EvalCtx, matcher: TextMatcher): string {
  let v = ctx.lowerNeedles.get(matcher);
  if (v === undefined) {
    v = matcher.text.toLowerCase();
    ctx.lowerNeedles.set(matcher, v);
  }
  return v;
}

function getRegex(ctx: EvalCtx, matcher: RegexMatcher): RegExp {
  let re = ctx.regexes.get(matcher);
  if (!re) {
    re = new RegExp(matcher.source, matcher.flags + "g");
    ctx.regexes.set(matcher, re);
  }
  return re;
}

function clampToBasename(ranges: SearchMatchRange[], baseLen: number): SearchMatchRange[] {
  const out: SearchMatchRange[] = [];
  for (const r of ranges) {
    if (r.from < baseLen) out.push({ from: r.from, to: Math.min(r.to, baseLen) });
  }
  return out;
}

function mergeRanges(ranges: SearchMatchRange[]): SearchMatchRange[] {
  if (ranges.length === 0) return [];
  const sorted = ranges.slice().sort((a, b) => a.from - b.from || a.to - b.to);
  const out: SearchMatchRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) {
      if (r.to > last.to) last.to = r.to;
    } else {
      out.push({ from: r.from, to: r.to });
    }
  }
  return out;
}
