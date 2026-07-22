import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  certificateOrigins,
  loadCbaE2eSettings,
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
        AP2_PLAYWRIGHT_OUTPUT_DIR: join(credentials, "results"),
      },
      root,
    );

    expect(settings.pfx.toString()).toBe("test-pfx");
    expect(settings.passphrase).toBe("test-passphrase");
    expect(settings.outputDirectory).toBe(join(credentials, "results"));
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
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  return directory;
}
