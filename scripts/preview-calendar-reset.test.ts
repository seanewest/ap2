// @vitest-environment node

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { STUDENT_TENANT_ID } from "../api/identity.js";
import {
  CALENDAR_RESET_RUN_PROPERTY_ID,
  CALENDAR_RESET_USERS,
  previewCalendarReset,
  requiredLabConstructedAt,
  writeProtectedManifest,
  type CalendarResetPreviewManifest,
} from "./preview-calendar-reset.js";

const CUTOFF = "2026-07-23T12:00:00.000Z";
const CORY = CALENDAR_RESET_USERS[0];

function event(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    changeKey: `change-${id}`,
    createdDateTime: "2026-07-23T12:00:00.1234567Z",
    type: "singleInstance",
    isOrganizer: true,
    organizer: { emailAddress: { address: CORY.userPrincipalName } },
    attendees: [],
    isCancelled: false,
    singleValueExtendedProperties: [
      {
        id: CALENDAR_RESET_RUN_PROPERTY_ID,
        value: "ap2-calendar-20260724-002",
      },
    ],
    ...overrides,
  };
}

describe("calendar reset preview", () => {
  it("uses the fixed four-user allowlist and requires a past UTC construction time", () => {
    expect(CALENDAR_RESET_USERS).toEqual([
      {
        objectId: "1d102db5-eea8-48f0-9074-8a4847384770",
        userPrincipalName: "cory@corywest.onmicrosoft.com",
      },
      {
        objectId: "6e54e3a9-7651-4520-a331-047550ae6fca",
        userPrincipalName: "homer.simpson@corywest.onmicrosoft.com",
      },
      {
        objectId: "646cb944-5637-4410-bfc6-f338598e5804",
        userPrincipalName: "kobe@corywest.onmicrosoft.com",
      },
      {
        objectId: "9b7fc1a3-58a0-4440-8d09-796e4d405acd",
        userPrincipalName: "marge.simpson@corywest.onmicrosoft.com",
      },
    ]);
    expect(
      requiredLabConstructedAt(
        "2026-07-23T12:00:00Z",
        Date.parse("2026-07-24T00:00:00Z"),
      ),
    ).toBe(CUTOFF);
    expect(() =>
      requiredLabConstructedAt(
        "2026-07-23T08:00:00-04:00",
        Date.parse("2026-07-24T00:00:00Z"),
      ),
    ).toThrow("exact UTC");
    expect(() =>
      requiredLabConstructedAt(
        "2026-07-25T00:00:00Z",
        Date.parse("2026-07-24T00:00:00Z"),
      ),
    ).toThrow("future");
    expect(
      requiredLabConstructedAt(
        "2026-07-23T12:00:00.1234567Z",
        Date.parse("2026-07-24T00:00:00Z"),
      ),
    ).toBe("2026-07-23T12:00:00.1234567Z");
  });

  it("starts the documented source CLI under the repository runtime", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/preview-calendar-reset.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("follows every page, selects at-or-after cutoff, and classifies unsafe items", async () => {
    const next =
      `https://graph.microsoft.com/v1.0/users/${CORY.objectId}/events` +
      "?%24skiptoken=opaque";
    const request = vi.fn(async (
      input: string | URL | Request,
      _init?: RequestInit,
    ) => {
      const url = new URL(String(input));
      if (
        url.pathname === `/v1.0/users/${CORY.objectId}/events` &&
        url.searchParams.has("$skiptoken")
      ) {
        return new Response(
          JSON.stringify({
            value: [
              event("external", {
                attendees: [
                  { emailAddress: { address: "outside@example.com" } },
                ],
              }),
              event("malformed", { changeKey: undefined }),
              event("unmarked", {
                singleValueExtendedProperties: undefined,
              }),
            ],
          }),
          { status: 200 },
        );
      }
      if (url.pathname === `/v1.0/users/${CORY.objectId}/events`) {
        return new Response(
          JSON.stringify({
            value: [
              event("old", {
                createdDateTime: "2026-07-23T11:59:59.999Z",
              }),
              event("eligible"),
              event("recurring", { type: "seriesMaster" }),
            ],
            "@odata.nextLink": next,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });
    const credential = {
      getToken: vi.fn().mockResolvedValue({ token: "sensitive-token" }),
    };

    const manifest = await previewCalendarReset(CUTOFF, credential, request);

    expect(credential.getToken).toHaveBeenCalledWith(
      "https://graph.microsoft.com/.default",
    );
    expect(request).toHaveBeenCalledTimes(5);
    const firstUrl = new URL(String(request.mock.calls[0]![0]));
    expect(firstUrl.searchParams.get("$select")?.split(",")).toEqual([
      "id",
      "changeKey",
      "createdDateTime",
      "type",
      "isOrganizer",
      "organizer",
      "attendees",
      "isCancelled",
    ]);
    expect(firstUrl.searchParams.get("$expand")).toBe(
      `singleValueExtendedProperties($filter=id eq '${CALENDAR_RESET_RUN_PROPERTY_ID}')`,
    );
    for (const call of request.mock.calls) {
      expect(call[1]).toMatchObject({
        method: "GET",
        redirect: "error",
        headers: { Authorization: "Bearer sensitive-token" },
      });
    }
    expect(manifest.users).toEqual(CALENDAR_RESET_USERS);
    expect(manifest.items.map((item) => item.eventId)).toEqual([
      "eligible",
      "external",
      "malformed",
      "recurring",
      "unmarked",
    ]);
    expect(
      Object.fromEntries(
        manifest.items.map((item) => [item.eventId, item.refusalReasons]),
      ),
    ).toEqual({
      eligible: [],
      external: ["attendee_not_allowlisted"],
      malformed: ["malformed_event"],
      recurring: ["recurring_event"],
      unmarked: ["missing_ap2_marker"],
    });
    expect(manifest.items[0]?.createdDateTime).toBe(
      "2026-07-23T12:00:00.1234567Z",
    );
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("sensitive-token");
    expect(serialized).not.toContain("subject");
    expect(serialized).not.toContain("body");
  });

  it("compares the cutoff at full accepted fractional precision", async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return Response.json({
        value: url.pathname === `/v1.0/users/${CORY.objectId}/events`
          ? [
              event("before", {
                createdDateTime: "2026-07-23T12:00:00.1234566Z",
              }),
              event("boundary", {
                createdDateTime: "2026-07-23T12:00:00.1234567Z",
              }),
              event("after", {
                createdDateTime: "2026-07-23T12:00:00.1234568Z",
              }),
            ]
          : [],
      });
    });

    const manifest = await previewCalendarReset(
      "2026-07-23T12:00:00.1234567Z",
      { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
      request,
    );

    expect(manifest.labConstructedAt).toBe(
      "2026-07-23T12:00:00.1234567Z",
    );
    expect(manifest.items.map(({ eventId }) => eventId)).toEqual([
      "boundary",
      "after",
    ]);
  });

  it("refuses recurring, malformed, cancelled, and out-of-allowlist parties", async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return new Response(
        JSON.stringify({
          value:
            url.pathname === `/v1.0/users/${CORY.objectId}/events`
              ? [
                  event("indeterminate", { createdDateTime: "bad" }),
                  event("cancelled", { isCancelled: true }),
                  event("external-organizer", {
                    isOrganizer: false,
                    organizer: {
                      emailAddress: { address: "outside@example.com" },
                    },
                  }),
                  event("bad-attendee", { attendees: [{}] }),
                ]
              : [],
        }),
        { status: 200 },
      );
    });

    const manifest = await previewCalendarReset(
      CUTOFF,
      { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
      request,
    );

    expect(manifest.items.find((item) => item.eventId === "indeterminate"))
      .toMatchObject({
        selection: "indeterminate",
        classification: "refused",
        refusalReasons: ["malformed_event"],
      });
    expect(manifest.items.find((item) => item.eventId === "cancelled")
      ?.refusalReasons).toEqual(["already_cancelled"]);
    expect(manifest.items.find((item) => item.eventId === "external-organizer")
      ?.refusalReasons).toEqual(["organizer_not_allowlisted"]);
    expect(manifest.items.find((item) => item.eventId === "bad-attendee")
      ?.refusalReasons).toEqual(["malformed_event"]);
  });

  it("refuses unsafe pagination, Graph errors, and missing tokens", async () => {
    const unsafe = vi.fn(async () =>
      new Response(
        JSON.stringify({
          value: [],
          "@odata.nextLink": "https://evil.example/v1.0/users/id/events",
        }),
        { status: 200 },
      ),
    );
    await expect(
      previewCalendarReset(
        CUTOFF,
        { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
        unsafe,
      ),
    ).rejects.toThrow("unsafe calendar next link");
    expect(unsafe).toHaveBeenCalledTimes(1);

    const noRequest = vi.fn();
    await expect(
      previewCalendarReset(
        CUTOFF,
        { getToken: vi.fn().mockResolvedValue(null) },
        noRequest,
      ),
    ).rejects.toThrow("no Microsoft Graph access token");
    expect(noRequest).not.toHaveBeenCalled();

    await expect(
      previewCalendarReset(
        CUTOFF,
        { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
        vi.fn(async () => new Response("secret body", { status: 403 })),
      ),
    ).rejects.toThrow("HTTP 403");
  });

  it("writes an exclusive mode-0600 manifest outside the repository", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-calendar-preview-"));
    chmodSync(directory, 0o700);
    const output = join(directory, "manifest.json");
    const manifest: CalendarResetPreviewManifest = {
      schemaVersion: 1,
      operation: "calendar-reset-preview",
      tenantId: STUDENT_TENANT_ID,
      labConstructedAt: CUTOFF,
      selectionRule: "createdDateTime >= labConstructedAt",
      users: CALENDAR_RESET_USERS,
      items: [],
    };

    expect(writeProtectedManifest(output, manifest)).toBe(output);
    expect(statSync(output).mode & 0o077).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(manifest);
    expect(() => writeProtectedManifest(output, manifest)).toThrow();
    expect(() =>
      writeProtectedManifest(
        join(process.cwd(), "manifest.json"),
        manifest,
      ),
    ).toThrow("outside the repository");
  });
});
