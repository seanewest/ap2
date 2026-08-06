import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createApiContainerProvenance,
  serializeApiContainerProvenance,
  summarizeApiContainerProvenance,
} from "./api-container-provenance.ts";

const temporaryRoots: string[] = [];
const fixtureRootfsDiffIds = [
  `sha256:${"1".repeat(64)}`,
  `sha256:${"2".repeat(64)}`,
];
const fixtureLayerDescriptors = fixtureRootfsDiffIds.map((_value, index) => ({
  mediaType:
    "application/vnd.docker.image.rootfs.diff.tar.gzip" as const,
  size: index + 1,
  digest: `sha256:${String(index + 1).repeat(64)}`,
}));
const fixtureLayerDescriptorsDigest = createHash("sha256").update(
  fixtureLayerDescriptors.map(({ digest, mediaType, size }) =>
    `${mediaType}\0${size}\0${digest}`
  ).join("\n") + "\n",
).digest("hex");
const fixtureRootfsDigest = createHash("sha256").update(
  fixtureRootfsDiffIds.join("\n") + "\n",
).digest("hex");

describe("API container provenance", () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("produces a deterministic bounded manifest without source or resolution contents", () => {
    const root = fixtureRepository();
    const first = createApiContainerProvenance(root);
    const second = createApiContainerProvenance(root);

    expect(second).toEqual(first);
    expect(first.baseImage).toEqual({
      classification: "pinned-platform-manifest",
      configDigest: `sha256:${"c".repeat(64)}`,
      indexDigest: `sha256:${"a".repeat(64)}`,
      layerDescriptorsDigest: fixtureLayerDescriptorsDigest,
      manifestDigest: `sha256:${"b".repeat(64)}`,
      platform: "linux/amd64",
      reference:
        `mcr.microsoft.com/playwright:v1.2.3-noble@sha256:${"b".repeat(64)}`,
      runtimeComponents: "reference-bound-not-enumerated",
      rootfsDiffIdsDigest: fixtureRootfsDigest,
      tagReference: "mcr.microsoft.com/playwright:v1.2.3-noble",
    });
    expect(first.productionComponents.count).toBe(1);
    expect(first.productionComponents.components).toEqual([
      {
        integrity: "sha512-fixture",
        name: "playwright",
        optional: false,
        version: "1.2.3",
      },
    ]);
    const serialized = serializeApiContainerProvenance(first);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized).not.toContain("private-source-sentinel");
    expect(serialized).not.toContain("registry.npmjs.org");
    expect(summarizeApiContainerProvenance(first)).toEqual({
      schemaVersion: 1,
      label: "API_CONTAINER_PROVENANCE",
      status: "pass",
      baseImage:
        `mcr.microsoft.com/playwright:v1.2.3-noble@sha256:${"b".repeat(64)}`,
      baseClassification: "pinned-platform-manifest",
      baseConfigDigest: `sha256:${"c".repeat(64)}`,
      baseIndexDigest: `sha256:${"a".repeat(64)}`,
      baseLayerDescriptorsDigest: fixtureLayerDescriptorsDigest,
      baseManifestDigest: `sha256:${"b".repeat(64)}`,
      basePlatform: "linux/amd64",
      baseRuntimeComponents: "reference-bound-not-enumerated",
      baseRootfsDiffIdsDigest: fixtureRootfsDigest,
      baseTag: "mcr.microsoft.com/playwright:v1.2.3-noble",
      buildInputCount: 10,
      buildInputsDigest: first.buildInputs.digest,
      buildArtifactClassification: "resolved-during-image-build",
      buildArtifactCount: 0,
      buildArtifactsDigest: null,
      lockfileDigest: first.lockfile.digest,
      productionComponentCount: 1,
      productionComponentsDigest: first.productionComponents.digest,
      attestation: "not-published",
    });
  });

  it("binds only the exact built API artifact when producing the image manifest", () => {
    const root = fixtureRepository();
    const first = createApiContainerProvenance(root, {
      bindBuildArtifacts: true,
    });
    expect(first.buildArtifacts).toMatchObject({
      classification: "bound-build-output",
      count: 1,
      files: [{
        bytes: 24,
        path: "dist-api/index.js",
      }],
    });

    writeFileSync(join(root, "dist-api", "index.js"), "export const built = 2;\n");
    const changed = createApiContainerProvenance(root, {
      bindBuildArtifacts: true,
    });
    expect(changed.buildArtifacts.digest).not.toBe(first.buildArtifacts.digest);
    expect(changed.buildInputs).toEqual(first.buildInputs);

    writeFileSync(join(root, "dist-api", "index.js.map"), "{}\n");
    expect(() =>
      createApiContainerProvenance(root, { bindBuildArtifacts: true })
    ).toThrow("API_CONTAINER_PROVENANCE_BUILD_ARTIFACT_SET");
  });

  it("changes only the build-input binding when copied source changes", () => {
    const root = fixtureRepository();
    const before = createApiContainerProvenance(root);
    writeFileSync(join(root, "api", "index.ts"), "export const value = 2;\n");
    const after = createApiContainerProvenance(root);

    expect(after.buildInputs.digest).not.toBe(before.buildInputs.digest);
    expect(after.lockfile).toEqual(before.lockfile);
    expect(after.productionComponents).toEqual(before.productionComponents);
  });

  it("fails closed on base-image drift", () => {
    const root = fixtureRepository();
    replace(
      join(root, "Dockerfile"),
      "mcr.microsoft.com/playwright:v1.2.3-noble",
      "mcr.microsoft.com/playwright:latest",
    );
    expect(() => createApiContainerProvenance(root)).toThrow(
      "API_CONTAINER_PROVENANCE_BASE_DRIFT",
    );

    const tagOnly = fixtureRepository();
    replace(
      join(tagOnly, "Dockerfile"),
      `@sha256:${"b".repeat(64)}`,
      "",
    );
    expect(() => createApiContainerProvenance(tagOnly)).toThrow(
      "API_CONTAINER_PROVENANCE_BASE_DRIFT",
    );

    const unreviewedDigest = fixtureRepository();
    replace(
      join(unreviewedDigest, "Dockerfile"),
      `sha256:${"b".repeat(64)}`,
      `sha256:${"c".repeat(64)}`,
    );
    expect(() => createApiContainerProvenance(unreviewedDigest)).toThrow(
      "API_CONTAINER_PROVENANCE_BASE_DRIFT",
    );
  });

  it("fails closed on a stale or malformed base lock", () => {
    const stale = fixtureRepository();
    mutateBaseLock(stale, (lock) => {
      lock.tag = "v1.2.2-noble";
    });
    expect(() => createApiContainerProvenance(stale)).toThrow(
      "API_CONTAINER_PROVENANCE_BASE_LOCK_STALE",
    );

    const wrongPlatform = fixtureRepository();
    mutateBaseLock(wrongPlatform, (lock) => {
      lock.platform.architecture = "arm64";
    });
    expect(() => createApiContainerProvenance(wrongPlatform)).toThrow(
      "API_CONTAINER_BASE_LOCK_SCHEMA",
    );

    const wrongDigest = fixtureRepository();
    mutateBaseLock(wrongDigest, (lock) => {
      lock.manifestDigest = "sha256:not-a-digest";
    });
    expect(() => createApiContainerProvenance(wrongDigest)).toThrow(
      "API_CONTAINER_BASE_LOCK_SCHEMA",
    );
  });

  it("fails closed on copied-source and embedded-manifest contract drift", () => {
    const redirectedSource = fixtureRepository();
    replace(
      join(redirectedSource, "Dockerfile"),
      "COPY src/ui ./src/ui",
      "COPY src/ui ./unmeasured-ui",
    );
    expect(() => createApiContainerProvenance(redirectedSource)).toThrow(
      "API_CONTAINER_PROVENANCE_BUILD_CONTRACT",
    );

    const missingGenerator = fixtureRepository();
    replace(
      join(missingGenerator, "Dockerfile"),
      "RUN node scripts/api-container-provenance.ts --output container-provenance.json\n",
      "",
    );
    expect(() => createApiContainerProvenance(missingGenerator)).toThrow(
      "API_CONTAINER_PROVENANCE_BUILD_CONTRACT",
    );

    const extraFinalCopy = fixtureRepository();
    replace(
      join(extraFinalCopy, "Dockerfile"),
      "COPY --from=build /app/container-provenance.json ./container-provenance.json",
      [
        "COPY --from=build /app/container-provenance.json ./container-provenance.json",
        "COPY --from=build /app/package.json ./package.json",
      ].join("\n"),
    );
    expect(() => createApiContainerProvenance(extraFinalCopy)).toThrow(
      "API_CONTAINER_PROVENANCE_BUILD_CONTRACT",
    );

    const caseAndWhitespaceEvasion = fixtureRepository();
    replace(
      join(caseAndWhitespaceEvasion, "Dockerfile"),
      "COPY --from=build /app/container-provenance.json ./container-provenance.json",
      [
        "COPY --from=build /app/container-provenance.json ./container-provenance.json",
        "copy\t--from=build /app/package.json ./package.json",
      ].join("\n"),
    );
    expect(() => createApiContainerProvenance(caseAndWhitespaceEvasion)).toThrow(
      "API_CONTAINER_PROVENANCE_BUILD_CONTRACT",
    );
  });

  it("fails closed on unsafe copied residue", () => {
    const root = fixtureRepository();
    writeFileSync(join(root, "scripts", ".env.fixture"), "fixture=true\n");
    expect(() => createApiContainerProvenance(root)).toThrow(
      "API_CONTAINER_PROVENANCE_UNSAFE_INPUT",
    );
  });

  it("fails closed on missing integrity or credentialed resolution metadata", () => {
    const missingIntegrity = fixtureRepository();
    mutateLock(missingIntegrity, (lock) => {
      delete lock.packages["node_modules/playwright"]!.integrity;
    });
    expect(() => createApiContainerProvenance(missingIntegrity)).toThrow(
      "API_CONTAINER_PROVENANCE_COMPONENT_METADATA",
    );

    const unsafeResolution = fixtureRepository();
    mutateLock(unsafeResolution, (lock) => {
      lock.packages["node_modules/playwright"]!.resolved =
        "https://x:y@localhost/playwright.tgz";
    });
    expect(() => createApiContainerProvenance(unsafeResolution)).toThrow(
      "API_CONTAINER_PROVENANCE_UNSAFE_RESOLUTION",
    );
  });

  it("requires installed non-optional components but permits absent optional candidates", () => {
    const missingRequired = fixtureRepository();
    rmSync(join(missingRequired, "node_modules", "playwright"), {
      recursive: true,
    });
    expect(() => createApiContainerProvenance(missingRequired)).toThrow(
      "API_CONTAINER_PROVENANCE_REQUIRED_COMPONENT_MISSING",
    );

    const optionalAbsent = fixtureRepository();
    mutateLock(optionalAbsent, (lock) => {
      lock.packages["node_modules/optional-fixture"] = {
        integrity: "sha512-optional",
        optional: true,
        resolved: "https://registry.npmjs.org/optional-fixture.tgz",
        version: "1.0.0",
      };
    });
    expect(createApiContainerProvenance(optionalAbsent).productionComponents.count)
      .toBe(1);
  });
});

function fixtureRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "ap2-container-provenance-"));
  temporaryRoots.push(root);
  for (const directory of [
    "api",
    "scripts",
    "src/api",
    "src/ui",
    "dist-api",
    "node_modules/playwright",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, ".dockerignore"), ".git\nnode_modules\n");
  writeFileSync(
    join(root, "Dockerfile"),
    [
      `FROM --platform=linux/amd64 mcr.microsoft.com/playwright:v1.2.3-noble@sha256:${"b".repeat(64)} AS build`,
      "WORKDIR /app",
      "COPY .dockerignore Dockerfile container-base-lock.json package.json package-lock.json tsconfig.json tsconfig.api.json vite.api.config.ts ./",
      "RUN npm ci",
      "COPY api ./api",
      "COPY scripts ./scripts",
      "COPY src/api ./src/api",
      "COPY src/ui ./src/ui",
      "RUN npm run build:api && rm -f dist-api/*.map",
      "RUN npm prune --omit=dev",
      "RUN node scripts/api-container-provenance.ts --output container-provenance.json",
      `FROM --platform=linux/amd64 mcr.microsoft.com/playwright:v1.2.3-noble@sha256:${"b".repeat(64)}`,
      "COPY --from=build /app/dist-api ./dist-api",
      "COPY --from=build /app/node_modules ./node_modules",
      "COPY --from=build /app/container-provenance.json ./container-provenance.json",
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, "package.json"), JSON.stringify({
    dependencies: { playwright: "1.2.3" },
  }));
  writeFileSync(join(root, "container-base-lock.json"), JSON.stringify({
    schemaVersion: 2,
    kind: "ap2-api-container-base-lock",
    registry: "mcr.microsoft.com",
    repository: "playwright",
    tag: "v1.2.3-noble",
    indexDigest: `sha256:${"a".repeat(64)}`,
    manifestDigest: `sha256:${"b".repeat(64)}`,
    configDigest: `sha256:${"c".repeat(64)}`,
    layerDescriptorsDigest: fixtureLayerDescriptorsDigest,
    layerDescriptors: fixtureLayerDescriptors,
    rootfsDiffIds: fixtureRootfsDiffIds,
    platform: {
      os: "linux",
      architecture: "amd64",
    },
  }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { playwright: "1.2.3" } },
      "node_modules/playwright": {
        integrity: "sha512-fixture",
        resolved: "https://registry.npmjs.org/playwright.tgz",
        version: "1.2.3",
      },
    },
  }));
  for (const path of ["tsconfig.api.json", "tsconfig.json", "vite.api.config.ts"]) {
    writeFileSync(join(root, path), "{}\n");
  }
  writeFileSync(join(root, "api", "index.ts"), "export const value = 1;\n");
  writeFileSync(join(root, "dist-api", "index.js"), "export const built = 1;\n");
  writeFileSync(
    join(root, "scripts", "build.ts"),
    "export const note = 'private-source-sentinel';\n",
  );
  writeFileSync(
    join(root, "node_modules", "playwright", "package.json"),
    JSON.stringify({ name: "playwright", version: "1.2.3" }),
  );
  return root;
}

function replace(path: string, from: string, to: string): void {
  const current = readFileSync(path, "utf8");
  writeFileSync(path, current.replaceAll(from, to));
}

function mutateLock(
  root: string,
  mutation: (lock: {
    packages: Record<string, Record<string, unknown>>;
  }) => void,
): void {
  const path = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(path, "utf8")) as {
    packages: Record<string, Record<string, unknown>>;
  };
  mutation(lock);
  writeFileSync(path, JSON.stringify(lock));
}

function mutateBaseLock(
  root: string,
  mutation: (lock: {
    tag: string;
    indexDigest: string;
    manifestDigest: string;
    configDigest: string;
    layerDescriptorsDigest: string;
    layerDescriptors: unknown[];
    rootfsDiffIds: string[];
    platform: { architecture: string; os: string };
  }) => void,
): void {
  const path = join(root, "container-base-lock.json");
  const lock = JSON.parse(readFileSync(path, "utf8")) as {
    tag: string;
    indexDigest: string;
    manifestDigest: string;
    configDigest: string;
    layerDescriptorsDigest: string;
    layerDescriptors: unknown[];
    rootfsDiffIds: string[];
    platform: { architecture: string; os: string };
  };
  mutation(lock);
  writeFileSync(path, JSON.stringify(lock));
}
