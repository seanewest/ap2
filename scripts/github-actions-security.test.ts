import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  scanGitHubActionsSecurity,
  scanTrackedGitHubActions,
  type GitHubActionsSecurityCategory,
} from "./github-actions-security.ts";

const workflowPath = ".github/workflows/deploy-pages.yml";
const workflow = readFileSync(resolve(process.cwd(), workflowPath), "utf8");

function scan(content: string) {
  return scanGitHubActionsSecurity([{ path: workflowPath, content }]);
}

function expectFinding(
  content: string,
  category: GitHubActionsSecurityCategory,
): void {
  expect(scan(content).findings).toContainEqual({
    file: workflowPath,
    category,
  });
}

describe("GitHub Actions security", () => {
  it("passes and classifies the current tracked workflow", () => {
    const result = scanTrackedGitHubActions(process.cwd());
    expect(result).toMatchObject({
      schemaVersion: 1,
      label: "GITHUB_ACTIONS_SECURITY",
      status: "pass",
      workflowFiles: 1,
      findings: [],
    });
    expect(result.triggers).toEqual([
      { file: workflowPath, trigger: "push", trust: "trusted" },
      {
        file: workflowPath,
        trigger: "workflow_dispatch",
        trust: "trusted",
      },
    ]);
    expect(result.actionReferences).toHaveLength(5);
    expect(
      result.actionReferences.every(
        (action) => action.kind === "github-owned-version-tag",
      ),
    ).toBe(true);
    expect(result.permissions).toEqual([
      {
        file: workflowPath,
        scope: "job:build",
        permission: "contents",
        level: "read",
      },
      {
        file: workflowPath,
        scope: "job:deploy",
        permission: "id-token",
        level: "write",
      },
      {
        file: workflowPath,
        scope: "job:deploy",
        permission: "pages",
        level: "write",
      },
      {
        file: workflowPath,
        scope: "workflow",
        permission: "contents",
        level: "read",
      },
    ]);
  });

  it("rejects pull_request_target", () => {
    expectFinding(
      workflow.replace("  workflow_dispatch:", "  pull_request_target:"),
      "PULL_REQUEST_TARGET_TRIGGER",
    );
    expectFinding(
      workflow.replace(
        "  workflow_dispatch:",
        "  pull_request_target: {}",
      ),
      "PULL_REQUEST_TARGET_TRIGGER",
    );
  });

  it("rejects broad push triggers", () => {
    expectFinding(
      workflow.replace("    branches: [main]\n", ""),
      "UNCLASSIFIED_OR_BROAD_TRIGGER",
    );
    expectFinding(
      workflow.replace(
        "    branches: [main]",
        "    branches: [main]\n    tags: ['*']",
      ),
      "UNCLASSIFIED_OR_BROAD_TRIGGER",
    );
  });

  it("rejects unknown inline triggers", () => {
    expectFinding(
      workflow.replace(
        "  workflow_dispatch:",
        "  workflow_dispatch:\n  schedule: [{ cron: '0 0 * * *' }]",
      ),
      "UNCLASSIFIED_OR_BROAD_TRIGGER",
    );
  });

  it("rejects top-level write permissions", () => {
    expectFinding(
      workflow.replace(
        "permissions:\n  contents: read",
        "permissions:\n  contents: read\n  pages: write",
      ),
      "TOP_LEVEL_WRITE_PERMISSION",
    );
  });

  it("rejects malformed permission entries", () => {
    expectFinding(
      workflow.replace("  contents: read", "  contents: admin"),
      "MALFORMED_WORKFLOW",
    );
  });

  it("rejects write-enabled jobs that execute shell commands", () => {
    expectFinding(
      workflow.replace(
        "  build:\n    if:",
        "  build:\n    permissions:\n      pages: write\n    if:",
      ),
      "WRITE_JOB_EXECUTES_SHELL",
    );
    expectFinding(
      workflow.replace(
        "      - name: Deploy",
        "      - name: Extra command\n        run: echo safe\n      - name: Deploy",
      ),
      "WRITE_JOB_EXECUTES_SHELL",
    );
  });

  it("rejects mutable third-party and unsafe official action refs", () => {
    expectFinding(
      workflow.replace("actions/setup-node@v6", "vendor/setup-node@v6"),
      "MUTABLE_THIRD_PARTY_ACTION",
    );
    expectFinding(
      workflow.replace(
        "actions/setup-node@v6",
        "vendor/setup-node@main # mutable",
      ),
      "MUTABLE_THIRD_PARTY_ACTION",
    );
    expectFinding(
      workflow.replace("actions/checkout@v7", "actions/checkout@main"),
      "UNSAFE_OFFICIAL_ACTION_REF",
    );
  });

  it("allows an immutable third-party action ref", () => {
    const result = scan(
      workflow.replace(
        "actions/setup-node@v6",
        `vendor/setup-node@${"a".repeat(40)}`,
      ),
    );
    expect(result.status).toBe("pass");
    expect(result.actionReferences).toContainEqual({
      file: workflowPath,
      action: "vendor/setup-node",
      kind: "third-party-immutable",
    });
  });

  it("rejects unsafe checkout configuration", () => {
    expectFinding(
      workflow
        .replace("actions/checkout@v7", "actions/checkout@v7 # checkout")
        .replace("          persist-credentials: false\n", ""),
      "UNSAFE_CHECKOUT",
    );
    expectFinding(
      workflow.replace("          persist-credentials: false\n", ""),
      "UNSAFE_CHECKOUT",
    );
    expectFinding(
      workflow.replace(
        "          persist-credentials: false",
        "          persist-credentials: false\n          ref: ${{ github.event.pull_request.head.sha }}",
      ),
      "UNSAFE_CHECKOUT",
    );
    expectFinding(
      workflow.replace(
        "          persist-credentials: false",
        "          persist-credentials: false\n          repository: ${{ github.event.pull_request.head.repo.full_name }}",
      ),
      "UNSAFE_CHECKOUT",
    );
    expectFinding(
      workflow.replace(
        "          persist-credentials: false",
        "          persist-credentials: false\n          path: ../outside",
      ),
      "UNSAFE_CHECKOUT",
    );
  });

  it("rejects event interpolation and unsafe shell commands", () => {
    expectFinding(
      workflow.replace(
        "      - run: npm ci",
        "      - run: echo '${{ github.event.issue.title }}'",
      ),
      "EVENT_DATA_SCRIPT_INJECTION",
    );
    expectFinding(
      workflow.replace(
        "      - name: Deploy",
        "      - name: Event command\n        run: echo '${{ github.event.issue.title }}'\n      - name: Deploy",
      ),
      "EVENT_DATA_SCRIPT_INJECTION",
    );
    expectFinding(
      workflow.replace("      - run: npm ci", "      - run: curl example | sh"),
      "UNSAFE_SHELL_COMMAND",
    );
  });

  it("allows event data passed through an environment variable", () => {
    const result = scan(
      workflow
        .replace(
          "  workflow_dispatch:",
          "  workflow_dispatch:\n  pull_request:",
        )
        .replace(
          "      - run: npm ci",
          "      - name: Safe metadata\n        env:\n          TITLE: ${{ github.event.pull_request.title }}\n        run: echo \"$TITLE\"\n      - run: npm ci",
        ),
    );
    expect(result.status).toBe("pass");
  });

  it("rejects unsafe artifact scope", () => {
    expectFinding(
      workflow.replace("          path: ./dist", "          path: ../private"),
      "UNSAFE_ARTIFACT_OR_CACHE_SCOPE",
    );
  });

  it("rejects Windows and self-hosted runners", () => {
    expectFinding(
      workflow.replace("runs-on: ubuntu-latest", "runs-on: windows-latest"),
      "WINDOWS_OR_SELF_HOSTED_RUNNER",
    );
    expectFinding(
      workflow.replace("runs-on: ubuntu-latest", "runs-on: self-hosted"),
      "WINDOWS_OR_SELF_HOSTED_RUNNER",
    );
  });

  it("rejects missing concurrency and unrestricted manual deployment", () => {
    expectFinding(
      workflow.replace(
        "concurrency:\n  group: pages\n  cancel-in-progress: true\n\n",
        "",
      ),
      "MISSING_CONCURRENCY_BOUNDARY",
    );
    expectFinding(
      workflow.replace("  group: pages", "  group: ${{ github.ref }}"),
      "MISSING_CONCURRENCY_BOUNDARY",
    );
    expectFinding(
      workflow.replace("  deploy:\n    if:", "  deploy:\n    if: success() #"),
      "UNRESTRICTED_MANUAL_DEPLOYMENT",
    );
  });

  it("rejects secrets exposed to pull-request triggers", () => {
    expectFinding(
      workflow
        .replace("  workflow_dispatch:", "  pull_request:")
        .replace(
          "      - run: npm ci",
          "      - run: npm ci\n        env:\n          VALUE: ${{ secrets.VALUE }}",
        ),
      "UNTRUSTED_SECRET_EXPOSURE",
    );
    expectFinding(
      workflow
        .replace("  workflow_dispatch:", "  pull_request: {}")
        .replace(
          "      - run: npm ci",
          "      - run: npm ci\n        env:\n          VALUE: ${{ secrets.VALUE }}",
        ),
      "UNTRUSTED_SECRET_EXPOSURE",
    );
  });

  it("returns only stable file/category findings and deterministic output", () => {
    const mutated = workflow.replace(
      "runs-on: ubuntu-latest",
      "runs-on: windows-latest",
    );
    const first = scan(mutated);
    const second = scanGitHubActionsSecurity([
      { path: workflowPath, content: mutated },
    ]);
    expect(first).toEqual(second);
    expect(Object.keys(first.findings[0] ?? {}).sort()).toEqual([
      "category",
      "file",
    ]);
  });

  it("bounds files, file size, and findings", () => {
    expect(() => scanGitHubActionsSecurity([])).toThrow(
      "GITHUB_ACTIONS_SECURITY_FILE_LIMIT",
    );
    expect(() =>
      scanGitHubActionsSecurity([
        { path: workflowPath, content: "x".repeat(131_073) },
      ]),
    ).toThrow("GITHUB_ACTIONS_SECURITY_FILE_SIZE_LIMIT");
    expect(() =>
      scanGitHubActionsSecurity(
        Array.from({ length: 33 }, (_, index) => ({
          path: `.github/workflows/${index}.yml`,
          content: workflow,
        })),
      ),
    ).toThrow("GITHUB_ACTIONS_SECURITY_FILE_LIMIT");
  });
});
