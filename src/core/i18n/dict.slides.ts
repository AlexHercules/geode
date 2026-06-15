/**
 * i18n dictionary fragment — Slides presentation mode (R74). Namespaces:
 * slides.* / cmd.startPresentation. `zh` is keyed against `en` so a missing
 * translation is a type error.
 */
export const en = {
  "cmd.startPresentation": "Start presentation",
  "slides.close": "Stop presentation",
  "slides.prev": "Previous slide",
  "slides.next": "Next slide",
  "slides.counter": "{current} / {total}",
} as const;

export const zh: Record<keyof typeof en, string> = {
  "cmd.startPresentation": "开始演示",
  "slides.close": "结束演示",
  "slides.prev": "上一页",
  "slides.next": "下一页",
  "slides.counter": "{current} / {total}",
};
