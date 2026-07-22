import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const productTenant = "b224230b-e540-4726-bae7-00b92b1c1cbc";
const studentTenant = "92563293-315c-4b6c-9b90-bcb47ee8c970";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function fakeAzurePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ap2-fake-az-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "az");
  await writeFile(
    path,
    `#!/usr/bin/env bash
set -eu
if [[ "$1 $2" == "account show" ]]; then
  printf '{"tenantId":"%s","tenantDisplayName":"Fake tenant","user":{"name":"dev@example.com"}}\\n' "$FAKE_ACCOUNT_TENANT"
elif [[ "$1 $2" == "account get-access-token" ]]; then
  printf '%s\\n' "$FAKE_TOKEN_TENANT"
else
  printf 'requested command: %s\\n' "$*"
fi
`,
  );
  await chmod(path, 0o755);
  return directory;
}

function runWrapper(fakePath: string, expectedTenant: string, accountTenant: string, tokenTenant: string) {
  return spawnSync(
    resolve("scripts/az-in-tenant.sh"),
    [expectedTenant, "--", "ad", "app", "list"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakePath}:${process.env.PATH ?? ""}`,
        FAKE_ACCOUNT_TENANT: accountTenant,
        FAKE_TOKEN_TENANT: tokenTenant,
      },
    },
  );
}

describe("az-in-tenant.sh", () => {
  it("runs only when the selected account and token match the expected tenant", async () => {
    const fakePath = await fakeAzurePath();

    const success = runWrapper(fakePath, productTenant, productTenant, productTenant);
    expect(success.status).toBe(0);
    expect(success.stdout).toContain("requested command: ad app list");
    expect(success.stderr).toContain(`Azure tenant asserted: Fake tenant (${productTenant})`);

    const wrongAccount = runWrapper(fakePath, productTenant, studentTenant, productTenant);
    expect(wrongAccount.status).toBe(1);
    expect(wrongAccount.stdout).not.toContain("requested command");
    expect(wrongAccount.stderr).toContain("Tenant mismatch");

    const wrongToken = runWrapper(fakePath, productTenant, productTenant, studentTenant);
    expect(wrongToken.status).toBe(1);
    expect(wrongToken.stdout).not.toContain("requested command");
    expect(wrongToken.stderr).toContain("Token tenant mismatch");
  });
});
