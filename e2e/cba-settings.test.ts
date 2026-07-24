import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  certificateOrigins,
  FIRST_API_RESPONSE_TIMEOUT_MS,
  loadCbaE2eSettings,
  STUDENT_OPERATOR,
  STUDENT_TENANT_ID,
} from "./cba-settings";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("CBA browser settings", () => {
  it("uses the dedicated Student operator", () => {
    expect(STUDENT_OPERATOR).toBe(
      "after-party-operator@corywest.onmicrosoft.com",
    );
    expect(FIRST_API_RESPONSE_TIMEOUT_MS).toBe(90_000);
  });

  it("targets both exact Microsoft certificate-authentication origins", () => {
    expect(certificateOrigins(STUDENT_TENANT_ID)).toEqual([
      "https://certauth.login.microsoftonline.com",
      `https://t${STUDENT_TENANT_ID}.certauth.login.microsoftonline.com`,
    ]);
  });

  it("loads a private PFX and keeps browser output outside the project", async () => {
    const root = await temporaryDirectory("ap2-project-");
    const credentials = await temporaryDirectory("ap2-cba-");
    const pfxPath = join(credentials, "operator.pfx");
    await writeFile(pfxPath, "test-pfx");
    await chmod(pfxPath, 0o600);

    const settings = loadCbaE2eSettings(
      {
        AP2_CBA_PFX_PATH: pfxPath,
        AP2_CBA_PFX_PASSPHRASE: "test-passphrase",
        AP2_E2E_API_BASE_URL: "https://api.example.test/",
        AP2_PLAYWRIGHT_OUTPUT_DIR: join(credentials, "results"),
      },
      root,
    );

    expect(settings.pfx.toString()).toBe("test-pfx");
    expect(settings.passphrase).toBe("test-passphrase");
    expect(settings.apiBaseUrl).toBe("https://api.example.test");
    expect(settings.outputDirectory).toBe(join(credentials, "results"));
  });

  it.each([
    [
      "https://seanewest.github.io/ap2/",
      "https://seanewest.github.io/ap2/",
    ],
    ["http://localhost:5173/", "http://localhost:5173/"],
    ["http://127.0.0.1:4173/", "http://127.0.0.1:4173/"],
    ["https://[::1]:4173/", "https://[::1]:4173/"],
  ])("preserves a safe app base URL: %s", async (appUrl, expected) => {
    const root = await temporaryDirectory("ap2-project-");
    const credentials = await temporaryDirectory("ap2-cba-");
    const pfxPath = await privatePfx(credentials);

    const settings = loadCbaE2eSettings(
      {
        AP2_CBA_PFX_PATH: pfxPath,
        AP2_CBA_PFX_PASSPHRASE: "test-passphrase",
        AP2_E2E_APP_URL: appUrl,
        AP2_PLAYWRIGHT_OUTPUT_DIR: join(credentials, "results"),
      },
      root,
    );

    expect(settings.appUrl).toBe(expected);
  });

  it.each([
    "ftp://seanewest.github.io/ap2/",
    "https://user:secret@seanewest.github.io/ap2/",
    "https://seanewest.github.io/ap2/?unsafe=true",
    "https://seanewest.github.io/ap2/#unsafe",
    "https://seanewest.github.io/ap2",
    "https://seanewest.github.io/",
    "https://seanewest.github.io/another-app/",
    "https://example.test/ap2/",
    "http://localhost:5173/ap2/",
    "not-an-absolute-url",
  ])("refuses an unsafe app base URL: %s", async (appUrl) => {
    const root = await temporaryDirectory("ap2-project-");
    const credentials = await temporaryDirectory("ap2-cba-");
    const pfxPath = await privatePfx(credentials);

    expect(() =>
      loadCbaE2eSettings(
        {
          AP2_CBA_PFX_PATH: pfxPath,
          AP2_CBA_PFX_PASSPHRASE: "test-passphrase",
          AP2_E2E_APP_URL: appUrl,
          AP2_PLAYWRIGHT_OUTPUT_DIR: join(credentials, "results"),
        },
        root,
      ),
    ).toThrow("AP2_E2E_APP_URL");
  });

  it("refuses an unsafe API evidence target", async () => {
    const root = await temporaryDirectory("ap2-project-");
    const credentials = await temporaryDirectory("ap2-cba-");
    const pfxPath = join(credentials, "operator.pfx");
    await writeFile(pfxPath, "test-pfx");
    await chmod(pfxPath, 0o600);

    expect(() =>
      loadCbaE2eSettings(
        {
          AP2_CBA_PFX_PATH: pfxPath,
          AP2_CBA_PFX_PASSPHRASE: "test-passphrase",
          AP2_E2E_API_BASE_URL:
            "https://user:secret@api.example.test?unsafe=true",
        },
        root,
      ),
    ).toThrow("AP2_E2E_API_BASE_URL");
  });

  it("refuses credentials inside the project or with broad permissions", async () => {
    const root = await temporaryDirectory("ap2-project-");
    const inside = join(root, "operator.pfx");
    await writeFile(inside, "test-pfx");
    await chmod(inside, 0o600);

    expect(() =>
      loadCbaE2eSettings(
        {
          AP2_CBA_PFX_PATH: inside,
          AP2_CBA_PFX_PASSPHRASE: "test-passphrase",
        },
        root,
      ),
    ).toThrow("outside the repository");

    const credentials = await temporaryDirectory("ap2-cba-");
    const broad = join(credentials, "operator.pfx");
    await writeFile(broad, "test-pfx");
    await chmod(broad, 0o644);

    expect(() =>
      loadCbaE2eSettings(
        {
          AP2_CBA_PFX_PATH: broad,
          AP2_CBA_PFX_PASSPHRASE: "test-passphrase",
        },
        root,
      ),
    ).toThrow("group or other users");
  });

  it("refuses a Playwright output symlink into the repository", async () => {
    const root = await temporaryDirectory("ap2-project-");
    const credentials = await temporaryDirectory("ap2-cba-");
    const pfxPath = await privatePfx(credentials);
    const inside = join(root, "browser-output");
    await mkdir(inside);
    const linkedOutput = join(credentials, "linked-output");
    await symlink(inside, linkedOutput, "dir");

    expect(() =>
      loadCbaE2eSettings(
        {
          AP2_CBA_PFX_PATH: pfxPath,
          AP2_CBA_PFX_PASSPHRASE: "test-passphrase",
          AP2_PLAYWRIGHT_OUTPUT_DIR: linkedOutput,
        },
        root,
      ),
    ).toThrow("symbolic-link");
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function privatePfx(directory: string): Promise<string> {
  const path = join(directory, "operator.pfx");
  await writeFile(path, "test-pfx");
  await chmod(path, 0o600);
  return path;
}
