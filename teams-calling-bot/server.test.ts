// @vitest-environment node

import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCallingBotServer } from "./server.js";

const servers: Array<ReturnType<typeof createCallingBotServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ));
});

describe("calling bot HTTP routes", () => {
  it("authenticates before parsing and accepts one bounded callback", async () => {
    const order: string[] = [];
    const handleNotificationEnvelope = vi.fn(() => {
      order.push("handled");
      return "accepted" as const;
    });
    const server = await start({
      revisionMarker: "fixture-r1",
      tokenVerifier: {
        verify: async () => {
          order.push("verified");
        },
      },
      canary: { handleNotificationEnvelope },
    });
    const base = url(server);
    const response = await fetch(`${base}/callbacks/calls`, {
      method: "POST",
      headers: {
        Authorization: "Bearer callback-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: [] }),
    });

    expect(response.status).toBe(202);
    expect(order).toEqual(["verified", "handled"]);
    expect(handleNotificationEnvelope).toHaveBeenCalledOnce();
  });

  it("rejects invalid authentication before malformed JSON is parsed", async () => {
    const canary = { handleNotificationEnvelope: vi.fn() };
    const server = await start({
      revisionMarker: "fixture-r1",
      tokenVerifier: { verify: async () => Promise.reject(new Error()) },
      canary,
    });
    const response = await fetch(`${url(server)}/callbacks/calls`, {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid",
        "Content-Type": "application/json",
      },
      body: "{not-json",
    });
    expect(response.status).toBe(401);
    expect(canary.handleNotificationEnvelope).not.toHaveBeenCalled();
  });

  it("caps callback bodies and exposes no mutation route", async () => {
    const server = await start({
      revisionMarker: "fixture-r1",
      tokenVerifier: { verify: async () => undefined },
      canary: {
        handleNotificationEnvelope: vi.fn(
          (_body: unknown, _digest: string): "accepted" => "accepted",
        ),
      },
      bodyLimit: 8,
    });
    const base = url(server);
    const oversized = await fetch(`${base}/callbacks/calls`, {
      method: "POST",
      headers: {
        Authorization: "Bearer callback-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tooLarge: true }),
    });
    expect(oversized.status).toBe(413);

    for (const path of [
      "/make-call",
      "/send",
      "/reply",
      "/forward",
      "/communications/calls",
    ]) {
      expect((await fetch(`${base}${path}`, { method: "POST" })).status).toBe(404);
    }
    expect((await fetch(`${base}/callbacks/calls`)).status).toBe(405);
    expect(await (await fetch(`${base}/health`)).json()).toEqual({
      status: "ok",
      revision: "fixture-r1",
    });
  });
});

async function start(
  dependencies: Parameters<typeof createCallingBotServer>[0],
): Promise<ReturnType<typeof createCallingBotServer>> {
  const server = createCallingBotServer(dependencies);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function url(server: ReturnType<typeof createCallingBotServer>): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
