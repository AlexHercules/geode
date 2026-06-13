/**
 * i18n dictionary fragment — All Properties sidebar view (R30). Namespace:
 * allproperties.*  `zh` is keyed against `en` so a missing translation is a
 * type error. `t()` does simple "{name}"-style interpolation (no ICU plurals);
 * the skipped-count suffix is composed in the panel.
 */
export const en = {
  "allproperties.empty": "No properties in this vault yet",
  "allproperties.filterPlaceholder": "Filter properties…",
  "allproperties.usageCountAria": "Used in {count} file(s)",
  "allproperties.menu": "Property options",
  "allproperties.rename": "Rename property…",
  "allproperties.renamePrompt": "Rename property “{key}” across the vault to:",
  "allproperties.renameDone": "Renamed “{old}” → “{new}” in {changed} file(s).",
  "allproperties.renameSkipped": " {skip} file(s) skipped.",
  "allproperties.renameNoop": "No files were changed.",
  "app.tabAllProperties": "All properties",
};

export const zh: Record<keyof typeof en, string> = {
  "allproperties.empty": "此仓库暂无属性",
  "allproperties.filterPlaceholder": "筛选属性…",
  "allproperties.usageCountAria": "被 {count} 个文件使用",
  "allproperties.menu": "属性选项",
  "allproperties.rename": "重命名属性…",
  "allproperties.renamePrompt": "将属性“{key}”在全库重命名为：",
  "allproperties.renameDone": "已将“{old}”→“{new}”在 {changed} 个文件中重命名。",
  "allproperties.renameSkipped": " 跳过 {skip} 个文件。",
  "allproperties.renameNoop": "没有文件被修改。",
  "app.tabAllProperties": "所有属性",
};
