import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createHash } from "node:crypto";
import type { CallbackTokenVerifier } from "./callback-auth.js";
import type { CallingCanary } from "./call-canary.js";

const DEFAULT_BODY_LIMIT = 32 * 1024;

export interface CallingBotServerDependencies {
  tokenVerifier: CallbackTokenVerifier;
  canary: Pick<CallingCanary, "handleNotificationEnvelope">;
  revisionMarker: string;
  bodyLimit?: number;
}

export function createCallingBotServer(
  dependencies: CallingBotServerDependencies,
): Server {
  return createServer((request, response) => {
    void route(request, response, dependencies).catch(() => {
      sendJson(response, 500, { error: "internal_server_error" });
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: CallingBotServerDependencies,
): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname === "/health" && request.method === "GET") {
    sendJson(response, 200, {
      status: "ok",
      revision: dependencies.revisionMarker,
    });
    return;
  }
  if (pathname === "/callbacks/calls" && request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  if (pathname !== "/callbacks/calls") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  const token = bearerToken(request.headers.authorization);
  if (!token) {
    sendJson(response, 401, { error: "invalid_callback_token" });
    return;
  }
  try {
    await dependencies.tokenVerifier.verify(token);
  } catch {
    sendJson(response, 401, { error: "invalid_callback_token" });
    return;
  }

  if (request.headers["content-type"]?.split(";", 1)[0]?.trim() !==
    "application/json") {
    sendJson(response, 415, { error: "json_required" });
    return;
  }

  let raw: Buffer;
  try {
    raw = await readBody(request, dependencies.bodyLimit ?? DEFAULT_BODY_LIMIT);
  } catch (error) {
    sendJson(
      response,
      error instanceof BodyTooLargeError ? 413 : 400,
      { error: "invalid_callback" },
    );
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    sendJson(response, 400, { error: "invalid_callback" });
    return;
  }

  const result = dependencies.canary.handleNotificationEnvelope(
    body,
    createHash("sha256").update(raw).digest("hex"),
  );
  if (result === "rejected") {
    sendJson(response, 422, { error: "callback_not_accepted" });
    return;
  }
  sendJson(response, 202, { status: "accepted" });
}

function bearerToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^Bearer ([^\s,]+)$/.exec(value);
  return match?.[1];
}

class BodyTooLargeError extends Error {}

async function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      length += chunk.length;
      if (length > limit) {
        settled = true;
        reject(new BodyTooLargeError());
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    request.on("error", () => {
      if (!settled) reject(new Error("Request body failed."));
    });
  });
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  if (response.headersSent || response.writableEnded) return;
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}
