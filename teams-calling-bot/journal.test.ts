// @vitest-environment node

import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExclusiveReducedJournal } from "./journal.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ExclusiveReducedJournal", () => {
  it("creates one mode-0600 journal and refuses overwrite", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-calling-journal-"));
    directories.push(directory);
    chmodSync(directory, 0o700);
    const path = join(directory, "call.jsonl");
    const journal = ExclusiveReducedJournal.open(
      path,
      "safe-run-marker",
      "request-digest",
    );
    journal.close();

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).not.toContain("token");
    expect(() =>
      ExclusiveReducedJournal.open(path, "safe-run-marker", "request-digest")
    ).toThrow();
  });
});
