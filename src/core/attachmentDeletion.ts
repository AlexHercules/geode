import type { MetadataIndex } from "./metadata";
import type { AttachmentDeleteMode } from "./appearance";
import { confirmAction } from "./confirm";
import { t } from "./i18n";

/**
 * R244: resolve which of a delete operation's orphaned attachments should be trashed, applying the
 * user's `attachmentDeleteMode` setting. Returns the attachment paths the caller should `vault.trash`
 * AFTER trashing the notes (the caller owns the flush→trash ordering). Empty when the mode is "keep",
 * there are no orphans, or the user declines the "ask" prompt.
 *
 * - `deletedNotePaths` = the .md notes being deleted (the caller expands folders to their notes).
 * - `deletedRoots` = the actual paths handed to vault.trash (may be folders). An orphan that lives
 *   INSIDE a deleted root is dropped here: it gets trashed with the folder, so trashing it again
 *   would double-trash (the second trash hits a moved path).
 *
 * Orphan detection (metadata.getOrphanedAttachments) covers body + frontmatter references, so an
 * attachment still referenced by another note's frontmatter is never returned. Deletions go to the
 * recoverable .trash; this never permanently deletes (permanent delete = R245, a hard boundary).
 */
export async function resolveAttachmentDeletion(
  metadata: MetadataIndex,
  deletedNotePaths: Set<string>,
  deletedRoots: string[],
  mode: AttachmentDeleteMode,
): Promise<string[]> {
  if (mode === "keep") return [];
  const orphans = metadata
    .getOrphanedAttachments(deletedNotePaths)
    .filter((a) => !deletedRoots.some((r) => a === r || a.startsWith(`${r}/`)));
  if (orphans.length === 0) return [];
  if (mode === "ask") {
    const list = orphans.map((a) => `• ${a}`).join("\n");
    const message = t("explorer.attachmentDeletePrompt", { count: orphans.length, list });
    if (!(await confirmAction(message, t("explorer.attachmentDeleteTitle")))) return [];
  }
  return orphans;
}
