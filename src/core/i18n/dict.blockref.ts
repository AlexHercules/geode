/**
 * i18n dictionary fragment — block reference (R77, ㊴). Namespaces:
 * cmd.copyBlock* / blockRef.*. `zh` is keyed against `en` so a missing
 * translation is a type error.
 */
export const en = {
  "cmd.copyBlockLink": "Copy link to block",
  "cmd.copyBlockEmbed": "Copy block as embed",
  "blockRef.copied": "Copied {link}",
  "blockRef.noBlock": "No block to link at the cursor",
  "blockRef.noSafeLink": "Couldn't build a safe link to this block",
} as const;

export const zh: Record<keyof typeof en, string> = {
  "cmd.copyBlockLink": "复制块引用链接",
  "cmd.copyBlockEmbed": "复制块嵌入",
  "blockRef.copied": "已复制 {link}",
  "blockRef.noBlock": "光标处没有可引用的块",
  "blockRef.noSafeLink": "无法为该块生成安全链接",
};
