/**
 * Hover preview core state (R25 — 悬停预览 / Page Preview).
 *
 * Pure-TS state module for the hover preview feature. See ARCHITECTURE.md
 * "Round 25 additions — 悬停预览" (frozen contract). PURE READ-ONLY: this
 * module only holds settings Stores + the shared hover target Store. The
 * controller (features/hover) writes `hoverStore`; the preview card subscribes.
 *
 * Settings are localStorage-backed, mirroring the `autoUpdateLinks` idiom in
 * core/linkRewrite.ts (read initial value with default fallback; setter
 * persists via String(on) and calls store.set).
 */
import { Store } from "./store";

/** 一次悬停请求的目标（控制器写入，卡片消费）。 */
export interface HoverTarget {
  /** 解析出的目标笔记 vault 路径（已 resolveLink；unresolved → 不预览，控制器不写）*/
  path: string;
  /** subpath（"#heading" / "#^block" 去掉前导 "#" 后的原文；无则空串）*/
  subpath: string;
  /** 触发锚点的视口矩形（卡片定位锚）*/
  rect: { top: number; left: number; bottom: number; right: number };
}

const ENABLED_KEY = "geode.pagePreviewEnabled";
const REQUIRE_MODIFIER_KEY = "geode.pagePreviewRequireModifier";

function readEnabled(): boolean {
  // Default ON (official Page preview core plugin is enabled by default).
  try {
    return localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

function readRequireModifier(): boolean {
  // Default OFF (official default: editor needs Ctrl/Cmd, other sources none).
  try {
    return localStorage.getItem(REQUIRE_MODIFIER_KEY) === "true";
  } catch {
    return false;
  }
}

/** 设置 Store（R17/R23 先例：localStorage，消费侧读）。 */
/** 启用页面预览（geode.pagePreviewEnabled，默认 true——官方默认开）。 */
export const pagePreviewEnabled = new Store<boolean>(readEnabled());

export function setPagePreviewEnabled(v: boolean): void {
  pagePreviewEnabled.set(v);
  try {
    localStorage.setItem(ENABLED_KEY, String(v));
  } catch {
    /* storage unavailable — session-only */
  }
}

/** 要求所有来源都按 Ctrl/Cmd（geode.pagePreviewRequireModifier，默认 false）。 */
// false = 官方默认（编辑视图需 Ctrl/Cmd、其余无修饰）；true = 所有来源都需 Ctrl/Cmd
export const pagePreviewRequireModifier = new Store<boolean>(
  readRequireModifier(),
);

export function setPagePreviewRequireModifier(v: boolean): void {
  pagePreviewRequireModifier.set(v);
  try {
    localStorage.setItem(REQUIRE_MODIFIER_KEY, String(v));
  } catch {
    /* storage unavailable — session-only */
  }
}

/** 悬停延迟（ms）冻结常量：进入 SHOW_DELAY 后显示，离开 anchor+card HIDE_DELAY 后隐藏。 */
export const HOVER_SHOW_DELAY = 300;
export const HOVER_HIDE_DELAY = 120;

/**
 * 共享悬停目标 Store（chief 决策：单例导出，controller 写、card 订阅，初值 null）。
 */
export const hoverStore = new Store<HoverTarget | null>(null);
