// @vitest-environment node

import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { RehearsalStatus } from "../src/api/client.js";
import {
  AUTOMATION_API_SCOPE,
  checkRehearsalStatus,
} from "./check-rehearsal-status.js";

const status: RehearsalStatus = {
  appName: "ca-ap2-api",
  region: "East US",
  runningStatus: "Running",
  latestReadyRevision: "ca-ap2-api--revision",
};

describe("rehearsal status agent command", () => {
  it("starts directly under Node before validating its configuration", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/check-rehearsal-status.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          AP2_API_BASE_URL: "",
          AP2_AUTOMATION_CERTIFICATE_PATH: "",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "AP2_AUTOMATION_CERTIFICATE_PATH is required",
    );
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("gets the exact app-only API scope and passes the token only to the operation", async () => {
    const credential = {
      getToken: vi.fn().mockResolvedValue({ token: "sensitive-token" }),
    };
    const api = {
      getRehearsalStatus: vi.fn().mockResolvedValue(status),
    };

    const result = await checkRehearsalStatus(credential, api);

    expect(credential.getToken).toHaveBeenCalledWith(AUTOMATION_API_SCOPE);
    expect(api.getRehearsalStatus).toHaveBeenCalledWith("sensitive-token");
    expect(result).toEqual(status);
    expect(JSON.stringify(result)).not.toContain("sensitive-token");
  });

  it("does not call the API when Entra returns no token", async () => {
    const credential = { getToken: vi.fn().mockResolvedValue(null) };
    const api = { getRehearsalStatus: vi.fn() };

    await expect(checkRehearsalStatus(credential, api)).rejects.toThrow(
      "Microsoft Entra returned no API access token",
    );
    expect(api.getRehearsalStatus).not.toHaveBeenCalled();
  });
});
