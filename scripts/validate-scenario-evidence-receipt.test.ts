// @vitest-environment node

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANONICAL_RECEIPT_FIXTURES,
  NEGATIVE_RECEIPT_FIXTURES,
} from "../src/scenarios/scenario-evidence-receipt.fixtures.ts";
import {
  ReceiptCliError,
  validateScenarioEvidenceReceiptFile,
} from "./validate-scenario-evidence-receipt.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("scenario evidence receipt CLI", () => {
  it.each(CANONICAL_RECEIPT_FIXTURES)(
    "validates the repository $name fixture without a network",
    ({ receipt }) => {
      const path = receiptFile(receipt);
      const result = spawnSync(
        process.execPath,
        ["scripts/validate-scenario-evidence-receipt.ts", path],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(
        /^CLAIM\tCATEGORY\tSUBJECT\tASSERTION\tSTATE/m,
      );
      expect(result.stderr).toBe("");
    },
  );

  it("prints only a categorical receipt failure", () => {
    const fixture = NEGATIVE_RECEIPT_FIXTURES[4]!;
    const path = receiptFile(fixture.receipt);
    const result = spawnSync(
      process.execPath,
      ["scripts/validate-scenario-evidence-receipt.ts", path],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { PATH: process.env.PATH },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("INVALID\tstate-promotion\n");
    expect(result.stderr).not.toContain("producer-attribution");
  });

  it("does not echo malformed upstream input", () => {
    const path = textFile('{"privatePayload":"do-not-echo"}');
    const result = spawnSync(
      process.execPath,
      ["scripts/validate-scenario-evidence-receipt.ts", path],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { PATH: process.env.PATH },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("INVALID\tshape\n");
    expect(result.stderr).not.toContain("do-not-echo");
  });

  it("rejects missing arguments without reading a default path", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/validate-scenario-evidence-receipt.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { PATH: process.env.PATH },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("INVALID\targument\n");
  });

  it("rejects oversized files before parsing", () => {
    const path = textFile("x".repeat(256 * 1024 + 1));

    expect(() => validateScenarioEvidenceReceiptFile(path)).toThrowError(
      expect.objectContaining<Partial<ReceiptCliError>>({
        failure: "file",
      }),
    );
  });
});

function receiptFile(value: unknown): string {
  return textFile(`${JSON.stringify(value, null, 2)}\n`);
}

function textFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "ap2-receipt-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "receipt.json");
  writeFileSync(path, contents, { mode: 0o600 });
  return path;
}
