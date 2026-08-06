import { describe, expect, it, vi } from "vitest";
import { SHAREPOINT_DRIVE_ID } from "./sharepoint-file-proof";
import {
  GraphSharePointTrustedVersionLifecycle,
  TRUSTED_VERSION_ONE_CONTENT,
  TRUSTED_VERSION_TWO_CONTENT,
  TrustedVersionLifecycleError,
} from "./sharepoint-trusted-version-lifecycle";

const NOW = new Date("2026-07-29T12:00:00.000Z");
const input = {
  schemaVersion: 1,
  marker: "ap2-spv-abc123def456",
  expiresAt: "2026-07-29T12:10:00.000Z",
};
const folder = item("folder-id", "AP2 Trusted Version [ap2-spv-abc123def456]", 0, "folder-etag", "folder");
const folderFresh = item("folder-id", "AP2 Trusted Version [ap2-spv-abc123def456]", 0, "folder-etag-fresh", "folder");
const fileV1 = item("file-id", "trusted-version.txt", 49, "file-etag-1", "file");
const fileV2 = item("file-id", "trusted-version.txt", 70, "file-etag-2", "file");

describe("SharePoint trusted-version lifecycle", () => {
  it("binds two exact ordered versions and proves active cleanup", async () => {
    const request = vi.fn(sequence([
      response(404),
      json(201, folder),
      json(201, fileV1),
      redirect("https://download.example/v1-current"),
      text(TRUSTED_VERSION_ONE_CONTENT),
      json(200, fileV2),
      redirect("https://download.example/v2-current-confirm"),
      text(TRUSTED_VERSION_TWO_CONTENT),
      json(200, {
        value: [
          { id: "2.0", size: 70, lastModifiedDateTime: "2026-07-29T12:00:02.000Z" },
          { id: "1.0", size: 49, lastModifiedDateTime: "2026-07-29T12:00:01.000Z" },
        ],
      }),
      json(200, { id: "2.0", size: 70, lastModifiedDateTime: "2026-07-29T12:00:02.000Z" }),
      redirect("https://download.example/v2-current"),
      text(TRUSTED_VERSION_TWO_CONTENT),
      redirect("https://download.example/v1-history"),
      text(TRUSTED_VERSION_ONE_CONTENT),
      response(204),
      json(200, folderFresh),
      json(200, { value: [] }),
      response(204),
      response(404),
      response(404),
    ]));
    const operation = new GraphSharePointTrustedVersionLifecycle(
      { getToken: vi.fn().mockResolvedValue({ token: "opaque" }) },
      undefined,
      request,
      () => NOW,
    );

    const result = await operation.run(input);
    expect(result.status).toBe("completed-cleaned");
    expect(result.versions.map(({ ordinal, size }) => ({ ordinal, size })))
      .toEqual([
        { ordinal: "changed-v2", size: 70 },
        { ordinal: "trusted-v1", size: 49 },
      ]);
    expect(result.terminal).toEqual({
      activeFile: "absent",
      activeFolder: "absent",
      recycleAndAuditHistory: "ordinary-platform-history-retained",
      expiry: "removed",
    });
    expect(result.markerDigestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.fileIdentityDigestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.journalDigestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(request).toHaveBeenCalledTimes(20);
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(2);
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "PUT")[1]![1]
        ?.headers,
    ).toMatchObject({ "If-Match": "file-etag-1" });
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "DELETE")[1]![1]
        ?.headers,
    ).toMatchObject({ "If-Match": "folder-etag-fresh" });
    expect(JSON.stringify(result)).not.toMatch(
      /driveId|folder-id|file-id|ap2-spv-abc123def456|@|\/home\/|token/i,
    );

  });

  it("reconciles an ambiguous version write without replaying it", async () => {
    const request = vi.fn(sequence([
      response(404),
      json(201, folder),
      json(201, fileV1),
      redirect("https://download.example/v1-current"),
      text(TRUSTED_VERSION_ONE_CONTENT),
      new TypeError("transport"),
      json(200, fileV2),
      redirect("https://download.example/v2-reconcile"),
      text(TRUSTED_VERSION_TWO_CONTENT),
      redirect("https://download.example/v2-confirm"),
      text(TRUSTED_VERSION_TWO_CONTENT),
      json(200, {
        value: [
          { id: "2.0", size: 70, lastModifiedDateTime: "2026-07-29T12:00:02.000Z" },
          { id: "1.0", size: 49, lastModifiedDateTime: "2026-07-29T12:00:01.000Z" },
        ],
      }),
      json(200, { id: "2.0", size: 70, lastModifiedDateTime: "2026-07-29T12:00:02.000Z" }),
      redirect("https://download.example/v2-current"),
      text(TRUSTED_VERSION_TWO_CONTENT),
      redirect("https://download.example/v1-history"),
      text(TRUSTED_VERSION_ONE_CONTENT),
      response(204),
      json(200, folderFresh),
      json(200, { value: [] }),
      response(204),
      response(404),
      response(404),
    ]));
    const operation = new GraphSharePointTrustedVersionLifecycle(
      { getToken: vi.fn().mockResolvedValue({ token: "opaque" }) },
      undefined,
      request,
      () => NOW,
    );

    await expect(operation.run(input)).resolves.toMatchObject({
      status: "completed-cleaned",
    });
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(2);
  });

  it("reconciles a malformed success body by exact path without replay", async () => {
    const request = vi.fn(sequence([
      response(404),
      json(201, { id: "incomplete" }),
      json(200, folder),
      json(201, fileV1),
      redirect("https://download.example/v1-current"),
      text(TRUSTED_VERSION_ONE_CONTENT),
      json(200, fileV2),
      redirect("https://download.example/v2-current-confirm"),
      text(TRUSTED_VERSION_TWO_CONTENT),
      json(200, {
        value: [
          { id: "2.0", size: 70, lastModifiedDateTime: "2026-07-29T12:00:02.000Z" },
          { id: "1.0", size: 49, lastModifiedDateTime: "2026-07-29T12:00:01.000Z" },
        ],
      }),
      json(200, { id: "2.0", size: 70, lastModifiedDateTime: "2026-07-29T12:00:02.000Z" }),
      redirect("https://download.example/v2-current"),
      text(TRUSTED_VERSION_TWO_CONTENT),
      redirect("https://download.example/v1-history"),
      text(TRUSTED_VERSION_ONE_CONTENT),
      response(204),
      json(200, folderFresh),
      json(200, { value: [] }),
      response(204),
      response(404),
      response(404),
    ]));
    const operation = new GraphSharePointTrustedVersionLifecycle(
      { getToken: vi.fn().mockResolvedValue({ token: "opaque" }) },
      undefined,
      request,
      () => NOW,
    );

    await expect(operation.run(input)).resolves.toMatchObject({
      status: "completed-cleaned",
    });
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(2);
  });

  it("never replays an ambiguous delete", async () => {
    const request = vi.fn(sequence([
      response(404),
      json(201, folder),
      json(201, fileV1),
      redirect("https://download.example/v1-current"),
      text(TRUSTED_VERSION_ONE_CONTENT),
      json(200, fileV2),
      redirect("https://download.example/v2-current-confirm"),
      text(TRUSTED_VERSION_TWO_CONTENT),
      json(200, {
        value: [
          { id: "2.0", size: 70, lastModifiedDateTime: "2026-07-29T12:00:02.000Z" },
          { id: "1.0", size: 49, lastModifiedDateTime: "2026-07-29T12:00:01.000Z" },
        ],
      }),
      json(200, { id: "2.0", size: 70, lastModifiedDateTime: "2026-07-29T12:00:02.000Z" }),
      redirect("https://download.example/v2-current"),
      text(TRUSTED_VERSION_TWO_CONTENT),
      redirect("https://download.example/v1-history"),
      text(TRUSTED_VERSION_ONE_CONTENT),
      new TypeError("delete transport"),
      json(200, fileV2),
      json(200, { value: [{ id: "file-id" }] }),
    ]));
    const operation = new GraphSharePointTrustedVersionLifecycle(
      { getToken: vi.fn().mockResolvedValue({ token: "opaque" }) },
      undefined,
      request,
      () => NOW,
    );

    await expect(operation.run(input)).rejects.toMatchObject({
      code: "cleanup-incomplete",
    });
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(1);
  });

  it("does not delete an object that appears after a definite create refusal", async () => {
    const request = vi.fn(sequence([
      response(404),
      response(409),
      response(404),
      json(200, folder),
    ]));
    const operation = new GraphSharePointTrustedVersionLifecycle(
      { getToken: vi.fn().mockResolvedValue({ token: "opaque" }) },
      undefined,
      request,
      () => NOW,
    );

    await expect(operation.run(input)).rejects.toMatchObject({
      code: "cleanup-incomplete",
    });
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(0);
  });

  it("stops producer writes at expiry while still cleaning retained state", async () => {
    const times = [
      new Date("2026-07-29T12:00:00.000Z"),
      new Date("2026-07-29T12:00:00.000Z"),
      new Date("2026-07-29T12:00:00.000Z"),
      new Date("2026-07-29T12:10:00.000Z"),
    ];
    const request = vi.fn(sequence([
      response(404),
      json(201, folder),
      json(200, folderFresh),
      json(200, { value: [] }),
      response(204),
      response(404),
      response(404),
    ]));
    const operation = new GraphSharePointTrustedVersionLifecycle(
      { getToken: vi.fn().mockResolvedValue({ token: "opaque" }) },
      undefined,
      request,
      () => times.shift() ?? NOW,
    );

    await expect(operation.run(input)).rejects.toMatchObject({
      code: "platform-refusal",
    });
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(0);
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(1);
  });

  it("rejects malformed markers and reused one-shot markers before Graph", async () => {
    const request = vi.fn(sequence([
      response(404),
      json(201, folder),
      json(201, fileV1),
      redirect("https://download.example/v1-current"),
      text(TRUSTED_VERSION_ONE_CONTENT),
      json(200, fileV2),
      redirect("https://download.example/v2-current-confirm"),
      text(TRUSTED_VERSION_TWO_CONTENT),
      json(200, {
        value: [
          { id: "2.0", size: 70, lastModifiedDateTime: "2026-07-29T12:00:02.000Z" },
          { id: "1.0", size: 49, lastModifiedDateTime: "2026-07-29T12:00:01.000Z" },
        ],
      }),
      json(200, { id: "2.0", size: 70, lastModifiedDateTime: "2026-07-29T12:00:02.000Z" }),
      redirect("https://download.example/v2-current"),
      text(TRUSTED_VERSION_TWO_CONTENT),
      redirect("https://download.example/v1-history"),
      text(TRUSTED_VERSION_ONE_CONTENT),
      response(204),
      json(200, folderFresh),
      json(200, { value: [] }),
      response(204),
      response(404),
      response(404),
    ]));
    const operation = new GraphSharePointTrustedVersionLifecycle(
      { getToken: vi.fn().mockResolvedValue({ token: "opaque" }) },
      undefined,
      request,
      () => NOW,
    );
    await expect(operation.run({ ...input, marker: "wrong" })).rejects
      .toMatchObject({
        code: "invalid-input",
      } satisfies Partial<TrustedVersionLifecycleError>);
    await operation.run(input);
    await expect(operation.run(input)).rejects.toMatchObject({
      code: "marker-reused",
    });
    expect(request).toHaveBeenCalledTimes(20);
  });
});

function item(
  id: string,
  name: string,
  size: number,
  eTag: string,
  kind: "file" | "folder",
): Record<string, unknown> {
  return {
    id,
    name,
    size,
    eTag,
    parentReference: { driveId: SHAREPOINT_DRIVE_ID },
    [kind]: {},
  };
}

function response(status: number): Response {
  return new Response(null, { status });
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function text(value: string): Response {
  return new Response(value, { status: 200 });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function sequence(
  results: Array<Response | Error>,
): typeof fetch {
  return (async () => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("Unexpected fetch.");
    return next;
  }) as typeof fetch;
}
