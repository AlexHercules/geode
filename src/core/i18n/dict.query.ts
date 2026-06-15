/**
 * i18n dictionary fragment — query embed (R75, ㊲). Namespace: query.*
 * `zh` is keyed against `en` so a missing translation is a type error.
 */
export const en = {
  "query.results": "{count} results",
  "query.empty": "No results",
  "query.error": "Query error",
} as const;

export const zh: Record<keyof typeof en, string> = {
  "query.results": "{count} 条结果",
  "query.empty": "无结果",
  "query.error": "查询错误",
};
