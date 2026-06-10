import type { TabState } from "@core/types";

/** STUB — replaced by the editor feature agent. Contract: named export, props { tab }. */
export function EditorPane({ tab }: { tab: TabState }) {
  return <div className="panel-stub">Editor for {tab.filePath ?? "(no file)"} (coming soon)</div>;
}
