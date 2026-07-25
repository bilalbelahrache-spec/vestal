import { test, expect } from "@playwright/test";
import { evaluateArchiveFile } from "../src/archive";

// Pure-logic tests, no running server needed. The hashes below are real
// SHA-256 digests of two 1000-byte buffers differing by exactly one
// flipped bit (see the Node one-liner that produced them) — the smallest
// possible real-world bit-rot event, not an invented placeholder string.
const ORIGINAL_HASH = "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3";
const CORRUPTED_HASH = "da1f65a5cfe15270bc22c8db2cd00038f300fc54c30290dcb90eace0c1c7b1ff";
const SAME_SIZE = 1000;
const SAME_MTIME = 1784800000;

test("a file never seen before is 'new'", () => {
  const result = evaluateArchiveFile(
    { path: "photo.jpg", size: SAME_SIZE, hash: ORIGINAL_HASH, mtime: SAME_MTIME },
    null,
  );
  expect(result.kind).toBe("new");
});

test("an identical re-hash is 'unchanged'", () => {
  const result = evaluateArchiveFile(
    { path: "photo.jpg", size: SAME_SIZE, hash: ORIGINAL_HASH, mtime: SAME_MTIME },
    { size: SAME_SIZE, hash: ORIGINAL_HASH, mtime: SAME_MTIME },
  );
  expect(result.kind).toBe("unchanged");
});

test("a hash change WITH a size change is a legitimate edit, not corruption", () => {
  const result = evaluateArchiveFile(
    { path: "photo.jpg", size: SAME_SIZE + 50, hash: CORRUPTED_HASH, mtime: SAME_MTIME + 100 },
    { size: SAME_SIZE, hash: ORIGINAL_HASH, mtime: SAME_MTIME },
  );
  expect(result.kind).toBe("legitimate_edit");
});

test("a hash change WITH only an mtime change (no size change) is still a legitimate edit", () => {
  const result = evaluateArchiveFile(
    { path: "photo.jpg", size: SAME_SIZE, hash: CORRUPTED_HASH, mtime: SAME_MTIME + 100 },
    { size: SAME_SIZE, hash: ORIGINAL_HASH, mtime: SAME_MTIME },
  );
  expect(result.kind).toBe("legitimate_edit");
});

test("the real one-bit-flip case: hash changes but size AND mtime are identical -> suspected corruption", () => {
  const result = evaluateArchiveFile(
    { path: "photo.jpg", size: SAME_SIZE, hash: CORRUPTED_HASH, mtime: SAME_MTIME },
    { size: SAME_SIZE, hash: ORIGINAL_HASH, mtime: SAME_MTIME },
  );
  expect(result.kind).toBe("suspected_corruption");
  if (result.kind === "suspected_corruption") {
    expect(result.reason).toContain(ORIGINAL_HASH.slice(0, 12));
    expect(result.reason).toContain(CORRUPTED_HASH.slice(0, 12));
  }
});
