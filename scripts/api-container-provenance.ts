import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const INPUT_FILES = [
  ".dockerignore",
  "Dockerfile",
  "package-lock.json",
  "package.json",
  "tsconfig.api.json",
  "tsconfig.json",
  "vite.api.config.ts",
] as const;
const INPUT_DIRECTORIES = [
  "api",
  "scripts",
  "src/api",
  "src/scenarios",
  "src/ui",
] as const;
const UNSAFE_INPUT_SEGMENTS = new Set([
  ".env",
  ".git",
  ".npm",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const UNSAFE_INPUT_SUFFIXES = [
  ".cer",
  ".crt",
  ".der",
  ".key",
  ".p12",
  ".pem",
  ".pfx",
] as const;

export interface ApiContainerComponent {
  integrity: string;
  name: string;
  optional: boolean;
  version: string;
}

export interface ApiContainerProvenance {
  schemaVersion: 1;
  kind: "ap2-api-container-provenance";
  baseImage: {
    classification: "mutable-version-tag";
    reference: string;
    runtimeComponents: "reference-bound-not-enumerated";
  };
  buildInputs: {
    digest: string;
    fileCount: number;
  };
  buildArtifacts:
    | {
      classification: "resolved-during-image-build";
      count: 0;
      digest: null;
      files: [];
    }
    | {
      classification: "bound-build-output";
      count: number;
      digest: string;
      files: Array<{
        bytes: number;
        digest: string;
        path: "dist-api/index.js";
      }>;
    };
  lockfile: {
    digest: string;
    lockfileVersion: 3;
  };
  productionComponents: {
    components: ApiContainerComponent[];
    count: number;
    digest: string;
    scope: "installed-node-production-dependencies";
  };
  publication: {
    attestation: "not-published";
    imageDigest: "resolved-after-build";
  };
}

interface PackageLockEntry {
  dev?: boolean;
  integrity?: string;
  optional?: boolean;
  resolved?: string;
  version?: string;
}

interface PackageLock {
  lockfileVersion?: number;
  packages?: Record<string, PackageLockEntry>;
}

interface PackageManifest {
  dependencies?: Record<string, string>;
}

export function createApiContainerProvenance(
  repositoryRoot: string,
  options: { bindBuildArtifacts?: boolean } = {},
): ApiContainerProvenance {
  const root = resolve(repositoryRoot);
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  const packageText = readFileSync(join(root, "package.json"), "utf8");
  const lockText = readFileSync(join(root, "package-lock.json"), "utf8");
  const packageManifest = parseJson<PackageManifest>(packageText, "package manifest");
  const packageLock = parseJson<PackageLock>(lockText, "package lock");
  const baseImage = validateContainerContract(
    dockerfile,
    packageManifest,
    packageLock,
  );
  const inputFiles = collectBuildInputs(root);
  const buildArtifacts = options.bindBuildArtifacts
    ? collectBuildArtifacts(root)
    : {
      classification: "resolved-during-image-build" as const,
      count: 0 as const,
      digest: null,
      files: [] as [],
    };
  const components = collectInstalledProductionComponents(root, packageLock);
  const componentLines = components.map((component) =>
    [
      component.name,
      component.version,
      component.integrity,
      component.optional ? "optional" : "required",
    ].join("\0")
  );

  return {
    schemaVersion: 1,
    kind: "ap2-api-container-provenance",
    baseImage: {
      classification: "mutable-version-tag",
      reference: baseImage,
      runtimeComponents: "reference-bound-not-enumerated",
    },
    buildInputs: {
      digest: digestLines(
        inputFiles.map(({ path, digest }) => `${path}\0${digest}`),
      ),
      fileCount: inputFiles.length,
    },
    buildArtifacts,
    lockfile: {
      digest: sha256(lockText),
      lockfileVersion: 3,
    },
    productionComponents: {
      components,
      count: components.length,
      digest: digestLines(componentLines),
      scope: "installed-node-production-dependencies",
    },
    publication: {
      attestation: "not-published",
      imageDigest: "resolved-after-build",
    },
  };
}

export function serializeApiContainerProvenance(
  provenance: ApiContainerProvenance,
): string {
  return `${JSON.stringify(provenance, null, 2)}\n`;
}

export function summarizeApiContainerProvenance(
  provenance: ApiContainerProvenance,
): Record<string, unknown> {
  return {
    schemaVersion: provenance.schemaVersion,
    label: "API_CONTAINER_PROVENANCE",
    status: "pass",
    baseImage: provenance.baseImage.reference,
    baseClassification: provenance.baseImage.classification,
    baseRuntimeComponents: provenance.baseImage.runtimeComponents,
    buildInputCount: provenance.buildInputs.fileCount,
    buildInputsDigest: provenance.buildInputs.digest,
    buildArtifactClassification: provenance.buildArtifacts.classification,
    buildArtifactCount: provenance.buildArtifacts.count,
    buildArtifactsDigest: provenance.buildArtifacts.digest,
    lockfileDigest: provenance.lockfile.digest,
    productionComponentCount: provenance.productionComponents.count,
    productionComponentsDigest: provenance.productionComponents.digest,
    attestation: provenance.publication.attestation,
  };
}

function validateContainerContract(
  dockerfile: string,
  packageManifest: PackageManifest,
  packageLock: PackageLock,
): string {
  if (packageLock.lockfileVersion !== 3 || !packageLock.packages?.[""]) {
    throw new Error("API_CONTAINER_PROVENANCE_LOCKFILE_CONTRACT");
  }
  const declaredDependencies = packageManifest.dependencies ?? {};
  const lockedDependencies = (
    packageLock.packages[""] as PackageLockEntry & {
      dependencies?: Record<string, string>;
    }
  ).dependencies ?? {};
  if (
    JSON.stringify(sortedEntries(declaredDependencies)) !==
    JSON.stringify(sortedEntries(lockedDependencies))
  ) {
    throw new Error("API_CONTAINER_PROVENANCE_ROOT_DEPENDENCY_DRIFT");
  }
  const playwrightVersion = declaredDependencies.playwright;
  if (!playwrightVersion || !/^\d+\.\d+\.\d+$/u.test(playwrightVersion)) {
    throw new Error("API_CONTAINER_PROVENANCE_PLAYWRIGHT_VERSION");
  }
  const fromLines = [...dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+\S+)?$/gimu)]
    .map((match) => match[1]);
  const expectedBase = `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`;
  if (
    fromLines.length !== 2 ||
    fromLines.some((reference) => reference !== expectedBase)
  ) {
    throw new Error("API_CONTAINER_PROVENANCE_BASE_DRIFT");
  }
  const secondStage = dockerfile.search(/^FROM\s+\S+\s*$/mu);
  if (secondStage < 0) {
    throw new Error("API_CONTAINER_PROVENANCE_BUILD_CONTRACT");
  }
  const buildStage = dockerfile.slice(0, secondStage);
  const finalStage = dockerfile.slice(secondStage);
  const buildCopies = instructionLines(buildStage, "COPY");
  const buildRuns = instructionLines(buildStage, "RUN");
  const finalCopies = instructionLines(finalStage, "COPY");
  const finalRuns = instructionLines(finalStage, "RUN");
  if (
    JSON.stringify(buildCopies) !== JSON.stringify([
      "COPY .dockerignore Dockerfile package.json package-lock.json tsconfig.json tsconfig.api.json vite.api.config.ts ./",
      "COPY api ./api",
      "COPY scripts ./scripts",
      "COPY src/api ./src/api",
      "COPY src/scenarios ./src/scenarios",
      "COPY src/ui ./src/ui",
    ]) ||
    JSON.stringify(buildRuns) !== JSON.stringify([
      "RUN npm ci",
      "RUN npm run build:api && rm -f dist-api/*.map",
      "RUN npm prune --omit=dev",
      "RUN node scripts/api-container-provenance.ts --output container-provenance.json",
    ]) ||
    JSON.stringify(finalCopies) !== JSON.stringify([
      "COPY --from=build /app/dist-api ./dist-api",
      "COPY --from=build /app/node_modules ./node_modules",
      "COPY --from=build /app/container-provenance.json ./container-provenance.json",
    ]) ||
    finalRuns.length !== 0 ||
    /^(?:ADD|ARG)\b/mu.test(dockerfile) ||
    /--mount=type=secret\b/u.test(dockerfile)
  ) {
    throw new Error("API_CONTAINER_PROVENANCE_BUILD_CONTRACT");
  }
  return expectedBase;
}

function instructionLines(dockerfile: string, instruction: string): string[] {
  const matchesInstruction = new RegExp(`^${instruction}\\s+`, "iu");
  return dockerfile
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => matchesInstruction.test(line));
}

function collectBuildInputs(
  root: string,
): Array<{ digest: string; path: string }> {
  const paths = [
    ...INPUT_FILES,
    ...INPUT_DIRECTORIES.flatMap((directory) =>
      walkRegularFiles(root, directory)
    ),
  ].sort();
  if (new Set(paths).size !== paths.length) {
    throw new Error("API_CONTAINER_PROVENANCE_DUPLICATE_INPUT");
  }
  return paths.map((path) => {
    assertSafeInputPath(path);
    const absolute = join(root, path);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
      throw new Error("API_CONTAINER_PROVENANCE_INPUT_MISSING");
    }
    return { path, digest: sha256(readFileSync(absolute)) };
  });
}

function walkRegularFiles(root: string, start: string): string[] {
  const absoluteStart = join(root, start);
  if (!existsSync(absoluteStart) || !lstatSync(absoluteStart).isDirectory()) {
    throw new Error("API_CONTAINER_PROVENANCE_INPUT_MISSING");
  }
  const files: string[] = [];
  const pending = [absoluteStart];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      continue;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      assertSafeInputPath(path);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile()) {
        files.push(path);
      } else {
        throw new Error("API_CONTAINER_PROVENANCE_NON_REGULAR_INPUT");
      }
    }
  }
  return files.sort();
}

function collectBuildArtifacts(
  root: string,
): Extract<
  ApiContainerProvenance["buildArtifacts"],
  { classification: "bound-build-output" }
> {
  const directory = join(root, "dist-api");
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    throw new Error("API_CONTAINER_PROVENANCE_BUILD_ARTIFACT_MISSING");
  }
  const entries = readdirSync(directory, { withFileTypes: true });
  if (
    entries.length !== 1 ||
    entries[0]?.name !== "index.js" ||
    !entries[0].isFile()
  ) {
    throw new Error("API_CONTAINER_PROVENANCE_BUILD_ARTIFACT_SET");
  }
  const path = "dist-api/index.js" as const;
  const contents = readFileSync(join(root, path));
  const file = {
    bytes: contents.byteLength,
    digest: sha256(contents),
    path,
  };
  return {
    classification: "bound-build-output",
    count: 1,
    digest: digestLines([
      `${file.path}\0${file.bytes}\0${file.digest}`,
    ]),
    files: [file],
  };
}

function assertSafeInputPath(path: string): void {
  const segments = path.toLowerCase().split("/");
  const file = basename(path).toLowerCase();
  if (
    segments.some((segment) => UNSAFE_INPUT_SEGMENTS.has(segment)) ||
    segments.some((segment) =>
      segment === "credentials" ||
      segment === "protected-evidence" ||
      segment === "session-state" ||
      segment === "token-cache"
    ) ||
    file.startsWith(".env") ||
    UNSAFE_INPUT_SUFFIXES.some((suffix) => file.endsWith(suffix))
  ) {
    throw new Error("API_CONTAINER_PROVENANCE_UNSAFE_INPUT");
  }
}

function collectInstalledProductionComponents(
  root: string,
  packageLock: PackageLock,
): ApiContainerComponent[] {
  const packages = packageLock.packages ?? {};
  const components: ApiContainerComponent[] = [];
  for (const [path, entry] of Object.entries(packages).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (!path.startsWith("node_modules/") || entry.dev === true) {
      continue;
    }
    const optional = entry.optional === true;
    const packagePath = join(root, path, "package.json");
    if (!existsSync(packagePath)) {
      if (optional) {
        continue;
      }
      throw new Error("API_CONTAINER_PROVENANCE_REQUIRED_COMPONENT_MISSING");
    }
    if (
      !entry.version ||
      !entry.integrity?.startsWith("sha512-") ||
      !entry.resolved
    ) {
      throw new Error("API_CONTAINER_PROVENANCE_COMPONENT_METADATA");
    }
    const resolved = new URL(entry.resolved);
    if (
      resolved.protocol !== "https:" ||
      resolved.username ||
      resolved.password ||
      resolved.search ||
      resolved.hash
    ) {
      throw new Error("API_CONTAINER_PROVENANCE_UNSAFE_RESOLUTION");
    }
    const installed = parseJson<{ name?: string; version?: string }>(
      readFileSync(packagePath, "utf8"),
      "installed package",
    );
    if (!installed.name || installed.version !== entry.version) {
      throw new Error("API_CONTAINER_PROVENANCE_INSTALLED_COMPONENT_DRIFT");
    }
    components.push({
      integrity: entry.integrity,
      name: installed.name,
      optional,
      version: entry.version,
    });
  }
  components.sort((left, right) =>
    `${left.name}\0${left.version}`.localeCompare(
      `${right.name}\0${right.version}`,
    )
  );
  return components;
}

function digestLines(lines: string[]): string {
  return sha256(`${lines.join("\n")}\n`);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortedEntries(value: Record<string, string>): Array<[string, string]> {
  return Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  );
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`API_CONTAINER_PROVENANCE_INVALID_${label.toUpperCase().replaceAll(" ", "_")}`);
  }
}

function runCli(): void {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const arguments_ = process.argv.slice(2);
  const writesManifest =
    arguments_.length === 2 &&
    arguments_[0] === "--output" &&
    arguments_[1] === "container-provenance.json";
  if (arguments_.length > 0 && !writesManifest) {
    throw new Error("API_CONTAINER_PROVENANCE_OUTPUT_ARGUMENT");
  }
  const provenance = createApiContainerProvenance(root, {
    bindBuildArtifacts: writesManifest,
  });
  if (writesManifest) {
    const output = arguments_[1];
    if (!output) {
      throw new Error("API_CONTAINER_PROVENANCE_OUTPUT_ARGUMENT");
    }
    writeFileSync(resolve(root, output), serializeApiContainerProvenance(provenance), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
  }
  process.stdout.write(`${JSON.stringify(summarizeApiContainerProvenance(provenance))}\n`);
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  runCli();
}
