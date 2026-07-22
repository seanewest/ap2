import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CallerNotAllowedError,
  InvalidClaimsError,
  authorizeClaims,
  type CallerPolicy,
} from "./auth-policy.js";
import { InvalidTokenError, type JwtVerifier } from "./jwt-verifier.js";

export interface ApiDependencies {
  jwtVerifier: JwtVerifier;
  callerPolicy: CallerPolicy;
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

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && pathname === "/api/whoami") {
    await whoAmI(request, response, dependencies);
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

async function whoAmI(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  const token = readBearerToken(request.headers.authorization);
  if (!token) {
    sendUnauthorized(response);
    return;
  }

  try {
    const claims = await dependencies.jwtVerifier.verify(token);
    const caller = authorizeClaims(claims, dependencies.callerPolicy);
    sendJson(response, 200, caller);
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
