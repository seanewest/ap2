import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isWindowsHostBoundarySurface,
  parseGitIndex,
  scanTrackedRepository,
  scanWindowsHostBoundary,
  type WindowsHostBoundaryCategory,
} from "./windows-host-boundary.ts";

type MutationFixture = Readonly<{
  name: string;
  path?: string;
  source: string;
  category: WindowsHostBoundaryCategory;
}>;

type AllowedFixtures = Readonly<{
  linuxOperation: string;
  isolatedBrowserOperation: string;
  nonExecutingMountReference: string;
  nonExecutingExecutableReference: string;
}>;

const mutationFixtures = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "scripts/fixtures/windows-host-boundary/mutations.json",
    ),
    "utf8",
  ),
) as MutationFixture[];

const allowedFixtures = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "scripts/fixtures/windows-host-boundary/allowed.json",
    ),
    "utf8",
  ),
) as AllowedFixtures;

function gitIndex(options: {
  path: string;
  mode?: number;
  flags?: number;
  extension?: string;
}): Buffer {
  const path = Buffer.from(options.path);
  const entryBytes = 62 + path.length + 1;
  const entry = Buffer.alloc(Math.ceil(entryBytes / 8) * 8);
  entry.writeUInt32BE(options.mode ?? 0o100644, 24);
  entry.writeUInt16BE(
    (Math.min(path.length, 0xfff) | (options.flags ?? 0)) & 0xffff,
    60,
  );
  path.copy(entry, 62);

  const header = Buffer.alloc(12);
  header.write("DIRC", 0, "ascii");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(1, 8);

  const extension = options.extension
    ? Buffer.concat([Buffer.from(options.extension, "ascii"), Buffer.alloc(4)])
    : Buffer.alloc(0);
  return Buffer.concat([header, entry, extension, Buffer.alloc(20)]);
}

describe("Windows host boundary", () => {
  it("passes the current tracked executable repository surfaces", () => {
    expect(scanTrackedRepository(process.cwd())).toMatchObject({
      schemaVersion: 1,
      label: "WINDOWS_HOST_BOUNDARY",
      status: "pass",
      findings: [],
    });
  });

  it.each(mutationFixtures)("$name", ({ path, source, category }) => {
    const result = scanWindowsHostBoundary([
      { path: path ?? "scripts/candidate.ts", content: source },
    ]);
    expect(result.status).toBe("fail");
    expect(result.findings).toContainEqual({
      file: path ?? "scripts/candidate.ts",
      category,
    });
  });

  it("allows legitimate Linux and isolated headless browser operations", () => {
    const result = scanWindowsHostBoundary([
      {
        path: "scripts/linux-operation.ts",
        content: allowedFixtures.linuxOperation,
      },
      {
        path: "e2e/browser.spec.ts",
        content: allowedFixtures.isolatedBrowserOperation,
      },
    ]);
    expect(result).toMatchObject({ status: "pass", findings: [] });
  });

  it("does not treat a non-executing mount reference as an execution target", () => {
    const result = scanWindowsHostBoundary([
      {
        path: "src/reference.ts",
        content: allowedFixtures.nonExecutingMountReference,
      },
    ]);
    expect(result).toMatchObject({ status: "pass", findings: [] });
  });

  it("returns only stable file and category findings", () => {
    const secretLikePayload = mutationFixtures[3]?.source ?? "";
    const result = scanWindowsHostBoundary([
      { path: "api/unsafe.ts", content: secretLikePayload },
    ]);
    expect(JSON.stringify(result)).not.toContain(secretLikePayload);
    expect(Object.keys(result.findings[0] ?? {}).sort()).toEqual([
      "category",
      "file",
    ]);
  });

  it("uses exact bounded inclusion and exclusion policy", () => {
    expect(isWindowsHostBoundarySurface("api/index.ts")).toBe(true);
    expect(isWindowsHostBoundarySurface("scripts/task.sh")).toBe(true);
    expect(isWindowsHostBoundarySurface("scripts/task.ps1")).toBe(true);
    expect(isWindowsHostBoundarySurface("scripts/task.py")).toBe(true);
    expect(isWindowsHostBoundarySurface("tools/host-task.ts")).toBe(true);
    expect(
      isWindowsHostBoundarySurface("infra/avd-three-vm-lab/contract.test.ts"),
    ).toBe(true);
    expect(
      isWindowsHostBoundarySurface("teams-calling-bot/Dockerfile"),
    ).toBe(true);
    expect(isWindowsHostBoundarySurface(".github/workflows/check.yml")).toBe(
      true,
    );
    expect(isWindowsHostBoundarySurface("package.json")).toBe(true);

    expect(isWindowsHostBoundarySurface("docs/example.ts")).toBe(false);
    expect(
      isWindowsHostBoundarySurface("scripts/w52-kobe-collection-boundary.mjs"),
    ).toBe(false);
    expect(
      isWindowsHostBoundarySurface("scripts/w52-kobe-youtrack-boundary.mjs"),
    ).toBe(false);
    expect(isWindowsHostBoundarySurface("scripts/rachel-gsa-standing.mjs")).toBe(
      false,
    );
    expect(
      isWindowsHostBoundarySurface(
        "scripts/fixtures/windows-host-boundary/mutations.json",
      ),
    ).toBe(false);
    expect(isWindowsHostBoundarySurface("dist/generated.js")).toBe(false);
    expect(isWindowsHostBoundarySurface("node_modules/vendor.js")).toBe(false);
    expect(isWindowsHostBoundarySurface("infra/template.bicep")).toBe(false);
    expect(isWindowsHostBoundarySurface("../outside.ts")).toBe(false);
  });

  it("fails closed on unscoped and oversized direct inputs", () => {
    expect(() =>
      scanWindowsHostBoundary([{ path: "docs/not-runtime.ts", content: "" }]),
    ).toThrow("WINDOWS_HOST_BOUNDARY_UNSCOPED_FILE");
    expect(() =>
      scanWindowsHostBoundary([
        { path: "src/oversized.ts", content: "x".repeat(1_048_577) },
      ]),
    ).toThrow("WINDOWS_HOST_BOUNDARY_FILE_SIZE_LIMIT");
  });

  it("does not treat a non-executing executable reference as an invocation", () => {
    const result = scanWindowsHostBoundary([
      {
        path: "src/reference.ts",
        content: allowedFixtures.nonExecutingExecutableReference,
      },
    ]);
    expect(result).toMatchObject({ status: "pass", findings: [] });
  });

  it("is deterministic regardless of caller ordering", () => {
    const files = [
      { path: "src/z.ts", content: "export const z = true;" },
      { path: "api/a.ts", content: "export const a = true;" },
    ] as const;
    expect(scanWindowsHostBoundary(files)).toEqual(
      scanWindowsHostBoundary([...files].reverse()),
    );
  });

  it("parses a bounded ordinary index entry", () => {
    expect(
      parseGitIndex(gitIndex({ path: "tools/task.ts", mode: 0o100755 })),
    ).toEqual([{ path: "tools/task.ts", executable: true }]);
  });

  it.each([
    {
      name: "split index",
      index: gitIndex({ path: "src/a.ts", extension: "link" }),
    },
    {
      name: "sparse index",
      index: gitIndex({ path: "src/a.ts", extension: "sdir" }),
    },
    {
      name: "merge stage",
      index: gitIndex({ path: "src/a.ts", flags: 0x1000 }),
    },
    {
      name: "tracked symlink",
      index: gitIndex({ path: "tools/task", mode: 0o120000 }),
    },
  ])("rejects unsupported $name state", ({ index }) => {
    expect(() => parseGitIndex(index)).toThrow(
      "WINDOWS_HOST_BOUNDARY_UNSUPPORTED_GIT_INDEX",
    );
  });

  it("rejects unsafe tracked paths before surface filtering", () => {
    expect(() =>
      parseGitIndex(gitIndex({ path: "scripts/unsafe name.ts" })),
    ).toThrow("WINDOWS_HOST_BOUNDARY_UNSAFE_GIT_PATH");
  });

  it("bounds candidate size before reading candidate content", () => {
    const root = mkdtempSync(resolve(tmpdir(), "ap2-boundary-"));
    try {
      mkdirSync(resolve(root, ".git"));
      mkdirSync(resolve(root, "src"));
      writeFileSync(
        resolve(root, ".git/index"),
        gitIndex({ path: "src/oversized.ts" }),
      );
      writeFileSync(resolve(root, "src/oversized.ts"), "");
      truncateSync(resolve(root, "src/oversized.ts"), 1_048_577);
      expect(() => scanTrackedRepository(root)).toThrow(
        "WINDOWS_HOST_BOUNDARY_NON_REGULAR_FILE",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a Git pointer to a Windows mount without opening it", () => {
    const root = mkdtempSync(resolve(tmpdir(), "ap2-boundary-"));
    try {
      writeFileSync(resolve(root, ".git"), "gitdir: /mnt/c/shared/repository");
      expect(() => scanTrackedRepository(root)).toThrow(
        "WINDOWS_HOST_BOUNDARY_INVALID_GIT_DIRECTORY",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
