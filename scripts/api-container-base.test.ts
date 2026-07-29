import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveApiContainerBase,
  serializeApiContainerBaseLock,
  validateMicrosoftRegistryUrl,
  type RegistryRedirectPolicy,
  type RegistryRead,
  type RegistryResponse,
} from "./api-container-base.ts";
import { updateApiContainerBase } from "./update-api-container-base.ts";

const temporaryRoots: string[] = [];

describe("API container base provenance", () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("cryptographically resolves the exact linux/amd64 child and config", async () => {
    const fixture = registryFixture();
    const first = await resolveApiContainerBase(
      "v1.2.3-noble",
      fixture.read,
    );
    const second = await resolveApiContainerBase(
      "v1.2.3-noble",
      fixture.read,
    );

    expect(second).toEqual(first);
    expect(first).toEqual({
      schemaVersion: 2,
      kind: "ap2-api-container-base-lock",
      registry: "mcr.microsoft.com",
      repository: "playwright",
      tag: "v1.2.3-noble",
      indexDigest: fixture.indexDigest,
      manifestDigest: fixture.manifestDigest,
      configDigest: fixture.configDigest,
      layerDescriptors: fixture.layerDescriptors,
      layerDescriptorsDigest: fixture.layerDescriptorsDigest,
      rootfsDiffIds: fixture.rootfsDiffIds,
      platform: { os: "linux", architecture: "amd64" },
    });
    expect(serializeApiContainerBaseLock(first).endsWith("}\n")).toBe(true);
    expect(fixture.calls.map(({ policy }) => policy)).toEqual([
      "direct",
      "direct",
      "mcr-content-addressed",
      "direct",
      "direct",
      "mcr-content-addressed",
    ]);
  });

  it("rejects wrong platform, digest, content type, and duplicate candidates", async () => {
    const wrongPlatform = registryFixture({ configArchitecture: "arm64" });
    await expect(resolveApiContainerBase("v1.2.3-noble", wrongPlatform.read))
      .rejects.toThrow("API_CONTAINER_BASE_UPDATE_CONFIG_PLATFORM");

    const wrongDigest = registryFixture({ corruptManifestDigest: true });
    await expect(resolveApiContainerBase("v1.2.3-noble", wrongDigest.read))
      .rejects.toThrow("API_CONTAINER_BASE_UPDATE_MANIFEST_DIGEST");

    const wrongType = registryFixture({ indexContentType: "application/json" });
    await expect(resolveApiContainerBase("v1.2.3-noble", wrongType.read))
      .rejects.toThrow("API_CONTAINER_BASE_UPDATE_RESPONSE");

    const duplicate = registryFixture({ duplicateAmd64: true });
    await expect(resolveApiContainerBase("v1.2.3-noble", duplicate.read))
      .rejects.toThrow("API_CONTAINER_BASE_UPDATE_PLATFORM");
  });

  it("allows one content-addressed MCR data redirect and no manifest redirects", () => {
    expect(validateMicrosoftRegistryUrl(
      "https://mcr.microsoft.com/v2/playwright/manifests/v1.2.3-noble",
      "direct",
      0,
    ).hostname).toBe("mcr.microsoft.com");
    expect(validateMicrosoftRegistryUrl(
      "https://eastus.data.mcr.microsoft.com/content?signature=fixture",
      "mcr-content-addressed",
      1,
    ).hostname).toBe("eastus.data.mcr.microsoft.com");
    for (const [url, policy, redirects] of [
      [
        "https://eastus.data.mcr.microsoft.com/content",
        "direct",
        1,
      ],
      [
        "https://eastus.data.mcr.microsoft.com/content",
        "mcr-content-addressed",
        2,
      ],
      [
        "https://example.blob.core.windows.net/content",
        "mcr-content-addressed",
        1,
      ],
      [
        [
          "https://user:secret",
          "mcr.microsoft.com/v2/playwright/manifests/tag",
        ].join("@"),
        "direct",
        0,
      ],
    ] as const) {
      expect(() =>
        validateMicrosoftRegistryUrl(url, policy, redirects)
      ).toThrow("API_CONTAINER_BASE_UPDATE_REDIRECT");
    }
  });

  it("updates only the reviewable Dockerfile and lock pair", async () => {
    const root = mkdtempSync(join(tmpdir(), "ap2-container-base-update-"));
    temporaryRoots.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { playwright: "1.2.3" } }),
    );
    writeFileSync(
      join(root, "Dockerfile"),
      [
        "FROM --platform=linux/amd64 mcr.microsoft.com/playwright:v1.2.2-noble@sha256:" +
        "a".repeat(64) + " AS build",
        "RUN true",
        "FROM --platform=linux/amd64 mcr.microsoft.com/playwright:v1.2.2-noble@sha256:" +
        "a".repeat(64),
        "",
      ].join("\n"),
    );
    const fixture = registryFixture();
    const lock = await resolveApiContainerBase("v1.2.3-noble", fixture.read);
    const result = await updateApiContainerBase(root, async (tag) => {
      expect(tag).toBe("v1.2.3-noble");
      return lock;
    });

    expect(result).toMatchObject({
      label: "API_CONTAINER_BASE_UPDATE",
      status: "updated",
      platform: "linux/amd64",
    });
    expect(readFileSync(join(root, "container-base-lock.json"), "utf8")).toBe(
      serializeApiContainerBaseLock(lock),
    );
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    expect(dockerfile.match(/^FROM\b.*$/gmu)).toEqual([
      `FROM --platform=linux/amd64 mcr.microsoft.com/playwright:v1.2.3-noble@${lock.manifestDigest} AS build`,
      `FROM --platform=linux/amd64 mcr.microsoft.com/playwright:v1.2.3-noble@${lock.manifestDigest}`,
    ]);
    await expect(updateApiContainerBase(root, async () => lock)).resolves
      .toMatchObject({ status: "unchanged" });
  });

  it("refuses an unbounded Dockerfile rewrite", async () => {
    const root = mkdtempSync(join(tmpdir(), "ap2-container-base-update-"));
    temporaryRoots.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { playwright: "1.2.3" } }),
    );
    writeFileSync(
      join(root, "Dockerfile"),
      "FROM attacker.invalid/image:latest AS build\nFROM attacker.invalid/image:latest\n",
    );
    const fixture = registryFixture();
    const lock = await resolveApiContainerBase("v1.2.3-noble", fixture.read);
    await expect(updateApiContainerBase(root, async () => lock)).rejects.toThrow(
      "API_CONTAINER_BASE_UPDATE_DOCKERFILE",
    );
  });
});

function registryFixture(
  options: {
    configArchitecture?: string;
    corruptManifestDigest?: boolean;
    duplicateAmd64?: boolean;
    indexContentType?: string;
  } = {},
): {
  calls: Array<{ path: string; policy: RegistryRedirectPolicy }>;
  indexDigest: string;
  manifestDigest: string;
  configDigest: string;
  layerDescriptorsDigest: string;
  layerDescriptors: Array<{
    digest: string;
    mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip";
    size: number;
  }>;
  rootfsDiffIds: string[];
  read: RegistryRead;
} {
  const rootfsDiffIds = [
    `sha256:${"1".repeat(64)}`,
    `sha256:${"2".repeat(64)}`,
  ];
  const config = Buffer.from(JSON.stringify({
    architecture: options.configArchitecture ?? "amd64",
    os: "linux",
    rootfs: { type: "layers", diff_ids: rootfsDiffIds },
  }));
  const configDigest = digest(config);
  const layers = rootfsDiffIds.map((_entry, index) => ({
    mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip" as const,
    size: index + 1,
    digest: `sha256:${String(index + 1).padStart(64, "0")}`,
  }));
  const manifest = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    config: {
      mediaType: "application/vnd.docker.container.image.v1+json",
      size: config.length,
      digest: configDigest,
    },
    layers,
  }));
  const manifestDigest = digest(manifest);
  const descriptor = {
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    size: manifest.length,
    digest: manifestDigest,
    platform: { architecture: "amd64", os: "linux" },
  };
  const manifests = options.duplicateAmd64
    ? [descriptor, { ...descriptor }]
    : [
      descriptor,
      {
        ...descriptor,
        digest: `sha256:${"c".repeat(64)}`,
        platform: { architecture: "arm64", os: "linux" },
      },
    ];
  const index = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.list.v2+json",
    manifests,
  }));
  const indexDigest = digest(index);
  const responses = new Map<string, RegistryResponse>([
    [
      "/v2/playwright/manifests/v1.2.3-noble",
      {
        body: index,
        contentDigest: indexDigest,
        contentType: options.indexContentType ??
          "application/vnd.docker.distribution.manifest.list.v2+json",
        status: 200,
      },
    ],
    [
      `/v2/playwright/manifests/${manifestDigest}`,
      {
        body: manifest,
        contentDigest: options.corruptManifestDigest
          ? `sha256:${"d".repeat(64)}`
          : manifestDigest,
        contentType: "application/vnd.docker.distribution.manifest.v2+json",
        status: 200,
      },
    ],
    [
      `/v2/playwright/blobs/${configDigest}`,
      {
        body: config,
        contentType: "application/octet-stream",
        status: 200,
      },
    ],
  ]);
  const calls: Array<{ path: string; policy: RegistryRedirectPolicy }> = [];
  return {
    calls,
    configDigest,
    indexDigest,
    layerDescriptorsDigest: createHash("sha256")
      .update(
        layers.map(({ digest, mediaType, size }) =>
          `${mediaType}\0${size}\0${digest}`
        ).join("\n") + "\n",
      )
      .digest("hex"),
    layerDescriptors: layers,
    manifestDigest,
    rootfsDiffIds,
    read: async (path, _accept, policy) => {
      calls.push({ path, policy });
      const response = responses.get(path);
      if (!response) {
        throw new Error("fixture response missing");
      }
      return response;
    },
  };
}

function digest(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
