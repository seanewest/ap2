import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { readTrackedPathsFromIndex } from "./windows-host-boundary.ts";

export const GITHUB_ACTIONS_SECURITY_LABEL =
  "GITHUB_ACTIONS_SECURITY" as const;

export const GITHUB_ACTIONS_SECURITY_CATEGORIES = [
  "MALFORMED_WORKFLOW",
  "UNCLASSIFIED_OR_BROAD_TRIGGER",
  "PULL_REQUEST_TARGET_TRIGGER",
  "MISSING_TOP_LEVEL_PERMISSIONS",
  "TOP_LEVEL_WRITE_PERMISSION",
  "WRITE_JOB_EXECUTES_SHELL",
  "UNTRUSTED_SECRET_EXPOSURE",
  "MUTABLE_THIRD_PARTY_ACTION",
  "UNSAFE_OFFICIAL_ACTION_REF",
  "UNSAFE_CHECKOUT",
  "EVENT_DATA_SCRIPT_INJECTION",
  "UNSAFE_SHELL_COMMAND",
  "UNSAFE_ARTIFACT_OR_CACHE_SCOPE",
  "WINDOWS_OR_SELF_HOSTED_RUNNER",
  "MISSING_CONCURRENCY_BOUNDARY",
  "UNRESTRICTED_MANUAL_DEPLOYMENT",
] as const;

export type GitHubActionsSecurityCategory =
  (typeof GITHUB_ACTIONS_SECURITY_CATEGORIES)[number];

export type GitHubActionsSecurityFinding = Readonly<{
  file: string;
  category: GitHubActionsSecurityCategory;
}>;

export type ActionReferenceClassification = Readonly<{
  file: string;
  action: string;
  kind:
    | "local"
    | "github-owned-immutable"
    | "github-owned-version-tag"
    | "third-party-immutable"
    | "unsafe";
}>;

export type PermissionClassification = Readonly<{
  file: string;
  scope: string;
  permission: string;
  level: "none" | "read" | "write";
}>;

export type TriggerClassification = Readonly<{
  file: string;
  trigger: string;
  trust: "trusted" | "untrusted" | "unsafe";
}>;

export type WorkflowText = Readonly<{
  path: string;
  content: string;
}>;

export type GitHubActionsSecurityResult = Readonly<{
  schemaVersion: 1;
  label: typeof GITHUB_ACTIONS_SECURITY_LABEL;
  status: "pass" | "fail";
  workflowFiles: number;
  triggers: readonly TriggerClassification[];
  actionReferences: readonly ActionReferenceClassification[];
  permissions: readonly PermissionClassification[];
  findings: readonly GitHubActionsSecurityFinding[];
}>;

const MAX_WORKFLOW_FILES = 32;
const MAX_WORKFLOW_BYTES = 131_072;
const MAX_TOTAL_BYTES = 524_288;
const MAX_REFERENCES = 128;
const MAX_PERMISSIONS = 128;
const MAX_FINDINGS = 128;
const SHA_REF = /^[0-9a-f]{40}$/u;
const VERSION_TAG = /^v[1-9][0-9]*$/u;
const SAFE_PERMISSION = /^[a-z][a-z-]*$/u;

function indentation(line: string): number {
  return line.length - line.trimStart().length;
}

function addFinding(
  findings: GitHubActionsSecurityFinding[],
  file: string,
  category: GitHubActionsSecurityCategory,
): void {
  if (
    !findings.some(
      (finding) => finding.file === file && finding.category === category,
    )
  ) {
    findings.push({ file, category });
  }
  if (findings.length > MAX_FINDINGS) {
    throw new Error("GITHUB_ACTIONS_SECURITY_FINDING_LIMIT");
  }
}

function classifyAction(
  file: string,
  uses: string,
): ActionReferenceClassification {
  if (uses.startsWith("./")) {
    return { file, action: "local", kind: "local" };
  }
  const match = /^([^/@\s]+)\/([^@\s]+)@([^@\s]+)$/u.exec(uses);
  if (!match) {
    return { file, action: "invalid", kind: "unsafe" };
  }
  const [, owner = "", repository = "", reference = ""] = match;
  const action = `${owner}/${repository}`;
  if (owner.toLowerCase() === "actions") {
    return {
      file,
      action,
      kind: SHA_REF.test(reference)
        ? "github-owned-immutable"
        : VERSION_TAG.test(reference)
          ? "github-owned-version-tag"
          : "unsafe",
    };
  }
  return {
    file,
    action,
    kind: SHA_REF.test(reference) ? "third-party-immutable" : "unsafe",
  };
}

function permissionBlocks(
  file: string,
  lines: readonly string[],
): {
  permissions: PermissionClassification[];
  malformed: boolean;
} {
  const permissions: PermissionClassification[] = [];
  let malformed = false;
  let currentJob = "";
  let inJobs = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (indentation(line) === 0 && line.trim() === "jobs:") {
      inJobs = true;
      continue;
    }
    if (indentation(line) === 0 && line.trim().endsWith(":")) {
      inJobs = line.trim() === "jobs:";
    }
    if (inJobs) {
      const job = /^  ([A-Za-z0-9_-]+):\s*$/u.exec(line);
      if (job) {
        currentJob = job[1] ?? "";
      }
    }
    const indent = indentation(line);
    if (
      line.trim() !== "permissions:" ||
      (indent !== 0 && !(inJobs && indent === 4 && currentJob))
    ) {
      continue;
    }
    const scope = indent === 0 ? "workflow" : `job:${currentJob}`;
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next] ?? "";
      if (candidate.trim() === "" || candidate.trimStart().startsWith("#")) {
        continue;
      }
      if (indentation(candidate) <= indent) {
        break;
      }
      const entry = /^\s+([a-z][a-z-]*):\s*(none|read|write)\s*$/u.exec(
        candidate,
      );
      if (!entry || !SAFE_PERMISSION.test(entry[1] ?? "")) {
        if (indentation(candidate) === indent + 2) {
          malformed = true;
        }
        continue;
      }
      permissions.push({
        file,
        scope,
        permission: entry[1] ?? "",
        level: (entry[2] ?? "none") as "none" | "read" | "write",
      });
      if (permissions.length > MAX_PERMISSIONS) {
        throw new Error("GITHUB_ACTIONS_SECURITY_PERMISSION_LIMIT");
      }
    }
  }
  return { permissions, malformed };
}

function blockText(
  lines: readonly string[],
  start: number,
  startIndent: number,
): string {
  const collected = [lines[start] ?? ""];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() !== "" && indentation(line) <= startIndent) {
      break;
    }
    collected.push(line);
  }
  return collected.join("\n");
}

function runCommandText(
  lines: readonly string[],
  start: number,
): string {
  const line = lines[start] ?? "";
  const value = /^\s*(?:-\s+)?run:\s*(.*)$/u.exec(line)?.[1] ?? "";
  if (value !== "|" && value !== ">") {
    return value;
  }
  const startIndent = indentation(line);
  const command: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const candidate = lines[index] ?? "";
    if (candidate.trim() !== "" && indentation(candidate) <= startIndent) {
      break;
    }
    command.push(candidate);
  }
  return command.join("\n");
}

function analyzeWorkflow(file: WorkflowText): {
  triggers: TriggerClassification[];
  actions: ActionReferenceClassification[];
  permissions: PermissionClassification[];
  findings: GitHubActionsSecurityFinding[];
} {
  const findings: GitHubActionsSecurityFinding[] = [];
  const triggers: TriggerClassification[] = [];
  const actions: ActionReferenceClassification[] = [];
  const lines = file.content.replace(/\r\n/gu, "\n").split("\n");
  const permissionResult = permissionBlocks(file.path, lines);
  const permissions = permissionResult.permissions;
  const hasPullRequest = /^\s{2}pull_request(?:_target)?:(?:\s.*)?$/mu.test(
    file.content,
  );
  const hasManualDispatch = /^\s{2}workflow_dispatch:(?:\s.*)?$/mu.test(
    file.content,
  );
  const hasSecrets = /\$\{\{\s*secrets\./u.test(file.content);
  const hasTopPermissions = permissions.some(
    (permission) => permission.scope === "workflow",
  );
  const topWrite = permissions.some(
    (permission) =>
      permission.scope === "workflow" && permission.level === "write",
  );
  const concurrencySafe =
    /^concurrency:\s*$/mu.test(file.content) &&
    /^\s{2}group:\s*[A-Za-z0-9._-]+\s*$/mu.test(file.content) &&
    /^\s{2}cancel-in-progress:\s*true\s*$/mu.test(file.content);
  const onStart = lines.findIndex((line) => line.trim() === "on:");
  if (onStart >= 0) {
    for (let index = onStart + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.trim() !== "" && indentation(line) === 0) {
        break;
      }
      const trigger = /^  ([A-Za-z0-9_-]+):(?:\s.*)?$/u.exec(line)?.[1];
      if (!trigger) {
        continue;
      }
      const trust =
        trigger === "push" || trigger === "workflow_dispatch"
          ? "trusted"
          : trigger === "pull_request"
            ? "untrusted"
            : "unsafe";
      triggers.push({ file: file.path, trigger, trust });
      if (trust === "unsafe") {
        addFinding(findings, file.path, "UNCLASSIFIED_OR_BROAD_TRIGGER");
      }
      if (
        trigger === "push"
      ) {
        const pushLines = blockText(lines, index, indentation(line))
          .split("\n")
          .filter(
            (candidate) =>
              candidate.trim() !== "" &&
              !candidate.trimStart().startsWith("#"),
          );
        if (
          pushLines.length !== 2 ||
          !/^\s{4}branches:\s*\[\s*main\s*\]\s*$/u.test(
            pushLines[1] ?? "",
          )
        ) {
          addFinding(findings, file.path, "UNCLASSIFIED_OR_BROAD_TRIGGER");
        }
      }
    }
  }
  if (triggers.length === 0) {
    addFinding(findings, file.path, "UNCLASSIFIED_OR_BROAD_TRIGGER");
  }

  if (
    file.content.includes("\t") ||
    permissionResult.malformed ||
    lines.some((line) => /^\s*permissions:\s*\S+/u.test(line)) ||
    !/^name:\s*\S+/mu.test(file.content) ||
    !/^on:\s*$/mu.test(file.content) ||
    !/^jobs:\s*$/mu.test(file.content)
  ) {
    addFinding(findings, file.path, "MALFORMED_WORKFLOW");
  }
  if (/^\s{2}pull_request_target:(?:\s.*)?$/mu.test(file.content)) {
    addFinding(findings, file.path, "PULL_REQUEST_TARGET_TRIGGER");
  }
  if (!hasTopPermissions) {
    addFinding(findings, file.path, "MISSING_TOP_LEVEL_PERMISSIONS");
  }
  if (topWrite) {
    addFinding(findings, file.path, "TOP_LEVEL_WRITE_PERMISSION");
  }
  if (hasPullRequest && hasSecrets) {
    addFinding(findings, file.path, "UNTRUSTED_SECRET_EXPOSURE");
  }
  if (!concurrencySafe) {
    addFinding(findings, file.path, "MISSING_CONCURRENCY_BOUNDARY");
  }

  let currentJob = "";
  let currentJobHasRun = false;
  const jobsWithRun = new Set<string>();
  const jobsRestrictedToMain = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const job = /^  ([A-Za-z0-9_-]+):\s*$/u.exec(line);
    if (job && currentJob !== "jobs") {
      if (currentJob && currentJobHasRun) {
        jobsWithRun.add(currentJob);
      }
      currentJob = job[1] ?? "";
      currentJobHasRun = false;
      continue;
    }
    if (
      currentJob &&
      /^\s{4}if:\s*github\.ref\s*==\s*['"]refs\/heads\/main['"]\s*$/u.test(
        line,
      )
    ) {
      jobsRestrictedToMain.add(currentJob);
    }
    if (
      /^\s{4}runs-on:\s*/u.test(line) &&
      !/^\s{4}runs-on:\s*ubuntu-[A-Za-z0-9.-]+\s*$/u.test(line)
    ) {
      addFinding(findings, file.path, "WINDOWS_OR_SELF_HOSTED_RUNNER");
    }
    const hasUses = /^\s*(?:-\s+)?uses:\s*/u.test(line);
    const uses = /^\s*(?:-\s+)?uses:\s*([^\s#]+)(?:\s+#.*)?$/u.exec(
      line,
    )?.[1];
    if (hasUses && !uses) {
      addFinding(findings, file.path, "MALFORMED_WORKFLOW");
    }
    if (uses) {
      const action = classifyAction(file.path, uses);
      actions.push(action);
      if (actions.length > MAX_REFERENCES) {
        throw new Error("GITHUB_ACTIONS_SECURITY_REFERENCE_LIMIT");
      }
      if (action.kind === "unsafe") {
        addFinding(
          findings,
          file.path,
          action.action.startsWith("actions/")
            ? "UNSAFE_OFFICIAL_ACTION_REF"
            : "MUTABLE_THIRD_PARTY_ACTION",
        );
      }
      if (action.action === "actions/checkout") {
        const step = blockText(lines, index, indentation(line));
        if (
          !/^\s+persist-credentials:\s*false\s*$/mu.test(step) ||
          /^\s+(?:ref|repository):\s*.*\$\{\{\s*(?:github\.event|github\.head_ref)/mu.test(
            step,
          ) ||
          /^\s+path:\s*(?:\/|\.\.)/mu.test(step)
        ) {
          addFinding(findings, file.path, "UNSAFE_CHECKOUT");
        }
      }
      if (
        /^(?:actions\/(?:cache|upload-artifact|upload-pages-artifact))$/u.test(
          action.action,
        )
      ) {
        const step = blockText(lines, index, indentation(line));
        if (
          /^\s+(?:key|path|restore-keys):\s*(?:\/|\.\.|\$\{\{\s*github\.event)/mu.test(
            step,
          )
        ) {
          addFinding(findings, file.path, "UNSAFE_ARTIFACT_OR_CACHE_SCOPE");
        }
      }
    }
    if (/^\s*(?:-\s+)?run:\s*/u.test(line)) {
      currentJobHasRun = true;
      const run = runCommandText(lines, index);
      if (
        /\$\{\{\s*(?:github\.event|github\.head_ref|github\.ref_name)/u.test(
          run,
        )
      ) {
        addFinding(findings, file.path, "EVENT_DATA_SCRIPT_INJECTION");
      }
      if (
        /(?:^|[;&|]\s*)(?:eval\b|(?:ba)?sh\s+-c\b)|curl\b[^\n|]*\|\s*(?:ba)?sh\b/imu.test(
          run,
        )
      ) {
        addFinding(findings, file.path, "UNSAFE_SHELL_COMMAND");
      }
    }
  }
  if (currentJob && currentJobHasRun) {
    jobsWithRun.add(currentJob);
  }

  for (const permission of permissions) {
    const job = permission.scope.startsWith("job:")
      ? permission.scope.slice("job:".length)
      : "";
    if (permission.level === "write" && jobsWithRun.has(job)) {
      addFinding(findings, file.path, "WRITE_JOB_EXECUTES_SHELL");
    }
    if (
      hasManualDispatch &&
      permission.level === "write" &&
      job &&
      !jobsRestrictedToMain.has(job)
    ) {
      addFinding(findings, file.path, "UNRESTRICTED_MANUAL_DEPLOYMENT");
    }
  }

  return { triggers, actions, permissions, findings };
}

export function scanGitHubActionsSecurity(
  files: readonly WorkflowText[],
): GitHubActionsSecurityResult {
  if (files.length === 0 || files.length > MAX_WORKFLOW_FILES) {
    throw new Error("GITHUB_ACTIONS_SECURITY_FILE_LIMIT");
  }
  let totalBytes = 0;
  const actions: ActionReferenceClassification[] = [];
  const triggers: TriggerClassification[] = [];
  const permissions: PermissionClassification[] = [];
  const findings: GitHubActionsSecurityFinding[] = [];
  const sorted = [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  for (const file of sorted) {
    const bytes = Buffer.byteLength(file.content);
    if (bytes > MAX_WORKFLOW_BYTES) {
      throw new Error("GITHUB_ACTIONS_SECURITY_FILE_SIZE_LIMIT");
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("GITHUB_ACTIONS_SECURITY_TOTAL_SIZE_LIMIT");
    }
    const result = analyzeWorkflow(file);
    triggers.push(...result.triggers);
    actions.push(...result.actions);
    permissions.push(...result.permissions);
    for (const finding of result.findings) {
      addFinding(findings, finding.file, finding.category);
    }
  }
  return {
    schemaVersion: 1,
    label: GITHUB_ACTIONS_SECURITY_LABEL,
    status: findings.length === 0 ? "pass" : "fail",
    workflowFiles: sorted.length,
    triggers: triggers.sort((left, right) =>
      `${left.file}:${left.trigger}`.localeCompare(`${right.file}:${right.trigger}`),
    ),
    actionReferences: actions.sort((left, right) =>
      `${left.file}:${left.action}`.localeCompare(`${right.file}:${right.action}`),
    ),
    permissions: permissions.sort((left, right) =>
      `${left.file}:${left.scope}:${left.permission}`.localeCompare(
        `${right.file}:${right.scope}:${right.permission}`,
      ),
    ),
    findings: findings.sort((left, right) =>
      `${left.file}:${left.category}`.localeCompare(
        `${right.file}:${right.category}`,
      ),
    ),
  };
}

export function scanTrackedGitHubActions(
  root: string,
): GitHubActionsSecurityResult {
  const absoluteRoot = realpathSync(resolve(root));
  const workflows = readTrackedPathsFromIndex(absoluteRoot)
    .map(({ path }) => path)
    .filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path));
  return scanGitHubActionsSecurity(
    workflows.map((path) => {
      const absolutePath = resolve(absoluteRoot, path);
      const stat = lstatSync(absolutePath);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.size > MAX_WORKFLOW_BYTES
      ) {
        throw new Error("GITHUB_ACTIONS_SECURITY_INVALID_FILE");
      }
      return { path, content: readFileSync(absolutePath, "utf8") };
    }),
  );
}
