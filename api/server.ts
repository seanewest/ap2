import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CallerNotAllowedError,
  InvalidClaimsError,
  authorizeClaims,
  type AuthorizedCaller,
  type CallerPolicy,
} from "./auth-policy.js";
import type { RehearsalStatusProvider } from "./rehearsal-status.js";
import { InvalidTokenError, type TokenVerifier } from "./token-verifier.js";

export interface ApiDependencies {
  tokenVerifier: TokenVerifier;
  callerPolicy: CallerPolicy;
  rehearsalStatusProvider: RehearsalStatusProvider;
  allowedOrigin?: string;
}

export function createApiServer(dependencies: ApiDependencies): Server {
  return createServer((request, response) => {
    void route(request, response, dependencies).catch(() => {
      sendJson(response, 500, { error: "internal_server_error" });
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const origin = request.headers.origin;
  if (origin) {
    if (!dependencies.allowedOrigin || origin !== dependencies.allowedOrigin) {
      sendJson(response, 403, { error: "origin_not_allowed" });
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }

  if (
    request.method === "OPTIONS" &&
    (pathname === "/api/whoami" || pathname === "/api/rehearsal-status")
  ) {
    handleProtectedGetPreflight(request, response, origin);
    return;
  }

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && pathname === "/api/whoami") {
    await whoAmI(request, response, dependencies);
    return;
  }

  if (request.method === "GET" && pathname === "/api/rehearsal-status") {
    await rehearsalStatus(request, response, dependencies);
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

function handleProtectedGetPreflight(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string | undefined,
): void {
  const requestedHeaders = (
    request.headers["access-control-request-headers"] ?? ""
  )
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (
    !origin ||
    request.headers["access-control-request-method"] !== "GET" ||
    requestedHeaders.length !== 1 ||
    requestedHeaders[0] !== "authorization"
  ) {
    sendJson(response, 403, { error: "cors_preflight_rejected" });
    return;
  }

  response.writeHead(204, {
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Allow-Methods": "GET",
    "Cache-Control": "no-store",
  });
  response.end();
}

async function whoAmI(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  await handleAuthorizedRequest(
    request,
    response,
    dependencies,
    (caller) => caller,
  );
}

async function rehearsalStatus(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  await handleAuthorizedRequest(request, response, dependencies, () =>
    dependencies.rehearsalStatusProvider.getStatus(),
  );
}

async function handleAuthorizedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  operation: (caller: AuthorizedCaller) => unknown | Promise<unknown>,
): Promise<void> {
  const token = readBearerToken(request.headers.authorization);
  if (!token) {
    sendUnauthorized(response);
    return;
  }

  try {
    const claims = await dependencies.tokenVerifier.verify(token);
    const caller = authorizeClaims(claims, dependencies.callerPolicy);
    sendJson(response, 200, await operation(caller));
  } catch (error) {
    if (error instanceof CallerNotAllowedError) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (error instanceof InvalidTokenError || error instanceof InvalidClaimsError) {
      sendUnauthorized(response);
      return;
    }
    throw error;
  }
}

function readBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
  return match?.[1];
}

function sendUnauthorized(response: ServerResponse): void {
  response.setHeader("WWW-Authenticate", "Bearer");
  sendJson(response, 401, { error: "unauthorized" });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}
