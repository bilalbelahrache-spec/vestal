export interface ArchiveFileRecord {
  path: string;
  size: number;
  hash: string;
  mtime: number;
}

export interface StoredArchiveFile {
  size: number;
  hash: string;
  mtime: number;
}

export type ArchiveFileVerdict =
  | { kind: "new" }
  | { kind: "unchanged" }
  | { kind: "legitimate_edit" }
  | { kind: "suspected_corruption"; reason: string };

/**
 * Decides what happened to ONE file between two syncs — pure, no I/O. This
 * is deliberately per-file, unlike the ransomware canary's per-check
 * rolling baseline (src/anomaly.ts): bit rot is a property of one file's
 * bytes, not a change in overall archive churn, so there's no "normal
 * variance" to compare against — either this exact file's content changed
 * for a reason the filesystem can explain, or it didn't.
 */
export function evaluateArchiveFile(
  incoming: ArchiveFileRecord,
  existing: StoredArchiveFile | null,
): ArchiveFileVerdict {
  if (!existing) return { kind: "new" };
  if (incoming.hash === existing.hash) return { kind: "unchanged" };

  // The hash changed. If size or mtime ALSO changed, this looks like a
  // real, intentional edit — the user (or their own software) actually
  // touched the file. If NEITHER did, the content changed with nothing on
  // the filesystem to explain why — that's the actual bit-rot signal: the
  // bytes are different, but nothing recorded ever touching the file.
  const sizeChanged = incoming.size !== existing.size;
  const mtimeChanged = incoming.mtime !== existing.mtime;
  if (sizeChanged || mtimeChanged) return { kind: "legitimate_edit" };

  return {
    kind: "suspected_corruption",
    reason:
      `content hash changed (${existing.hash.slice(0, 12)}... -> ${incoming.hash.slice(0, 12)}...) ` +
      `but file size and modification time are unchanged — the file wasn't touched, but its bytes are different.`,
  };
}
