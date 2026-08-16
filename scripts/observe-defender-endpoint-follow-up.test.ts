// @vitest-environment node

import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  alertEvidenceQuery,
  alertInfoQuery,
  observeDefenderEndpointFollowUp,
  type DefenderEndpointFollowUp,
} from "./observe-defender-endpoint-follow-up.js";

const INPUT: DefenderEndpointFollowUp = {
  start: "2026-08-15T09:45:00.000Z",
  end: "2026-08-15T11:04:48.000Z",
  deviceName: "ap2margefresh",
  machineId: "016fd10dbabe6d5a20bac13e48f71602a2bdcf6a",
  sha256: "1D332E11CAD8DF82CC5E148A4B04DA1833DC256F006E8F4E2C8E8D50C98EFF18",
  runId: "AP2-ENDPOINT-BG-20260815T1004Z",
};

describe("Defender endpoint follow-up observer", () => {
  it("retains W48's exact supported hunting query shape", () => {
    expect(alertInfoQuery(INPUT)).toBe(
      "AlertInfo | where Timestamp between (datetime(2026-08-15T09:45:00.000Z) .. datetime(2026-08-15T11:04:48.000Z)) | project Timestamp,AlertId,Title,Category,Severity,ServiceSource,DetectionSource",
    );
    expect(alertEvidenceQuery(INPUT)).toBe(
      'AlertEvidence | where Timestamp between (datetime(2026-08-15T09:45:00.000Z) .. datetime(2026-08-15T11:04:48.000Z)) | where DeviceName startswith "ap2margefresh" or SHA256 =~ "1D332E11CAD8DF82CC5E148A4B04DA1833DC256F006E8F4E2C8E8D50C98EFF18" or ProcessCommandLine has "AP2-ENDPOINT-BG-20260815T1004Z" | project Timestamp,AlertId,Title,EntityType,EvidenceRole,DeviceId,DeviceName,AccountName,AccountDomain,AccountSid,FileName,FolderPath,ProcessCommandLine,SHA1,SHA256,RemoteIP,RemoteUrl',
    );
  });

  it("uses only five bounded read-only alert and hunting requests", async () => {
    const graphCredential = {
      getToken: vi.fn().mockResolvedValue({ token: "graph-private-token" }),
    };
    const mdeCredential = {
      getToken: vi.fn().mockResolvedValue({ token: "mde-private-token" }),
    };
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const request = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      if (url.hostname === "api.securitycenter.microsoft.com") {
        return Response.json({
          value: [
            { alertCreationTime: "2026-08-15T10:00:00.000Z" },
            { alertCreationTime: "2026-08-15T12:00:00.000Z" },
          ],
        });
      }
      if (url.pathname.endsWith("/runHuntingQuery")) {
        const body = JSON.parse(String(init?.body)) as { Query: string };
        return Response.json({
          results: body.Query.startsWith("AlertInfo") ? [{}] : [{}, {}],
        });
      }
      if (url.pathname.endsWith("/alerts_v2")) {
        return Response.json({ value: [{}, {}], "@odata.nextLink": "capped" });
      }
      return Response.json({ value: [{}] });
    }) as typeof fetch;

    const result = await observeDefenderEndpointFollowUp(
      INPUT,
      graphCredential,
      mdeCredential,
      request,
    );

    expect(graphCredential.getToken).toHaveBeenCalledWith(
      "https://graph.microsoft.com/.default",
    );
    expect(mdeCredential.getToken).toHaveBeenCalledWith(
      "https://api.securitycenter.microsoft.com/.default",
    );
    expect(request).toHaveBeenCalledTimes(5);
    expect(result).toEqual({
      schema: "defender-endpoint-follow-up/v1",
      window: { start: INPUT.start, end: INPUT.end },
      counts: {
        mdeMachineAlerts: 1,
        graphAlerts: 2,
        graphIncidents: 1,
        alertInfo: 1,
        exactAlertEvidence: 2,
      },
      truncated: { graphAlerts: true, graphIncidents: false },
      limitations: {
        maxClosedWindowHours: 6,
        graphHuntingTimespan: "P1D",
        rawDeviceHuntingTablesQueried: false,
        deviceTimelineQueried: false,
        legacyMdeAdvancedQueryQueried: false,
      },
    });

    const mde = requests.find(({ url }) =>
      url.hostname === "api.securitycenter.microsoft.com"
    );
    expect(mde?.url.pathname).toBe(
      `/api/machines/${INPUT.machineId}/alerts`,
    );
    expect(mde?.init?.method).toBeUndefined();
    for (const { url, init } of requests) {
      expect(init?.redirect).toBe("error");
      expect(String(init?.headers)).not.toContain("private-token");
      if (!url.pathname.endsWith("/runHuntingQuery")) {
        expect(init?.body).toBeUndefined();
      }
    }
    const alerts = requests.find(({ url }) => url.pathname.endsWith("alerts_v2"));
    expect(alerts?.url.searchParams.get("$filter")).toBe(
      `createdDateTime ge ${INPUT.start} and createdDateTime le ${INPUT.end}`,
    );
    expect(alerts?.url.searchParams.get("$top")).toBe("200");
    const incidents = requests.find(({ url }) =>
      url.pathname.endsWith("incidents")
    );
    expect(incidents?.url.searchParams.get("$filter")).toBe(
      `lastUpdateDateTime ge ${INPUT.start} and lastUpdateDateTime le ${INPUT.end}`,
    );
    expect(incidents?.url.searchParams.get("$top")).toBe("50");
  });

  it("rejects unbounded and injectable inputs before authentication", async () => {
    const credential = { getToken: vi.fn() };
    for (const input of [
      { ...INPUT, end: "2026-08-15T16:00:00.001Z" },
      { ...INPUT, deviceName: 'host" | take 100' },
      { ...INPUT, runId: "bad run" },
      { ...INPUT, machineId: "short" },
      { ...INPUT, sha256: "short" },
    ]) {
      await expect(
        observeDefenderEndpointFollowUp(input, credential, credential, vi.fn()),
      ).rejects.toThrow();
    }
    expect(credential.getToken).not.toHaveBeenCalled();
  });

  it("fails closed on HTTP and malformed responses instead of reporting zero", async () => {
    const credential = {
      getToken: vi.fn().mockResolvedValue({ token: "private-token" }),
    };
    await expect(observeDefenderEndpointFollowUp(
      INPUT,
      credential,
      credential,
      vi.fn().mockResolvedValue(new Response("schema unavailable", { status: 400 })),
    )).rejects.toThrow("HTTP 400");

    await expect(observeDefenderEndpointFollowUp(
      INPUT,
      credential,
      credential,
      vi.fn().mockResolvedValue(Response.json({})),
    )).rejects.toThrow("response was malformed");
  });

  it.skipIf(Number(process.versions.node.split(".")[0]) < 22)(
    "starts directly under Node and rejects missing arguments before auth",
    () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/observe-defender-endpoint-follow-up.ts"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    },
  );
});
