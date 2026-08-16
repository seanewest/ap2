import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "scripts/github-deploy-key-probe.mjs"),
  "utf8",
);

describe("GitHub write deploy-key probe source contract", () => {
  it("is fixed to the proven repository and an explicit execution gate", () => {
    expect(source).toContain(
      'const repository = "ap2-v2-lab/maintainer-control-proof"',
    );
    expect(source).toContain('process.argv.slice(2).join(" ") !== "--execute"');
    expect(source).toContain("AP2_GITHUB_TOKEN_FILE");
    expect(source).not.toMatch(/admin-ap2\.token|\/var\/lib\/|\/home\//);
  });

  it("creates one write key and uses only a unique temporary branch", () => {
    expect(source).toContain('const branchPrefix = "ap2-write-deploy-key-probe-"');
    expect(source).toContain("read_only: false");
    expect(source).toContain('"-t",\n    "ed25519"');
    expect(source).toContain("deploy-key baseline is not empty");
    expect(source).toContain("Never replay an ambiguous create");
  });

  it("verifies the pushed SHA while protecting main", () => {
    expect(source).toContain('target?.default_branch !== "main"');
    expect(source.match(/commits\/main/g)).toHaveLength(2);
    expect(source).toContain('"ls-remote"');
    expect(source).toContain("verifiedRemoteSha !== pushedSha");
    expect(source).toContain("afterMainSha !== beforeMainSha");
  });

  it("removes the branch before the key and always removes private material", () => {
    const successfulCleanup = source.indexOf(
      "removeBranchIfPresent();\n  await removeKeyIfPresent();",
    );
    expect(successfulCleanup).toBeGreaterThan(0);
    expect(source).toContain('"--delete", branch');
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain(
      "rmSync(runDirectory, { recursive: true, force: true })",
    );
    expect(source).toContain("branchLookupAfter !== 404");
  });
});
