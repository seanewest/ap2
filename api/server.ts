import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CallerNotAllowedError,
  InvalidClaimsError,
  authorizeClaims,
  type AuthorizedCaller,
  type CallerPolicy,
} from "./auth-policy.js";
import type { RehearsalStatusProvider } from "./rehearsal-status.js";
import type { SimulatedEmailOperation } from "./simulated-email.js";
import {
  OneDriveProofConflictError,
  type OneDriveShareProofOperation,
} from "./onedrive-share-proof.js";
import { InvalidTokenError, type TokenVerifier } from "./token-verifier.js";

export interface ApiDependencies {
  tokenVerifier: TokenVerifier;
  callerPolicy: CallerPolicy;
  rehearsalStatusProvider: RehearsalStatusProvider;
  simulatedEmailOperation?: SimulatedEmailOperation;
  oneDriveShareProofOperation?: OneDriveShareProofOperation;
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
    handleProtectedPreflight(request, response, origin, ["GET"]);
    return;
  }

  if (
    request.method === "OPTIONS" &&
    pathname === "/api/simulated-email"
  ) {
    handleProtectedPreflight(request, response, origin, ["POST"]);
    return;
  }

  if (
    request.method === "OPTIONS" &&
    pathname === "/api/onedrive-share-proof"
  ) {
    handleProtectedPreflight(request, response, origin, [
      "GET",
      "POST",
      "DELETE",
    ]);
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

  if (request.method === "POST" && pathname === "/api/simulated-email") {
    await simulatedEmail(request, response, dependencies);
    return;
  }

  if (
    request.method === "POST" &&
    pathname === "/api/onedrive-share-proof"
  ) {
    await oneDriveShareProof(request, response, dependencies, "share");
    return;
  }

  if (
    request.method === "GET" &&
    pathname === "/api/onedrive-share-proof"
  ) {
    await oneDriveShareProof(request, response, dependencies, "verify");
    return;
  }

  if (
    request.method === "DELETE" &&
    pathname === "/api/onedrive-share-proof"
  ) {
    await oneDriveShareProof(request, response, dependencies, "remove");
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

function handleProtectedPreflight(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string | undefined,
  methods: readonly ("GET" | "POST" | "DELETE")[],
): void {
  const requestedHeaders = (
    request.headers["access-control-request-headers"] ?? ""
  )
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (
    !origin ||
    !methods.includes(
      request.headers["access-control-request-method"] as
        | "GET"
        | "POST"
        | "DELETE",
    ) ||
    requestedHeaders.length !== 1 ||
    requestedHeaders[0] !== "authorization"
  ) {
    sendJson(response, 403, { error: "cors_preflight_rejected" });
    return;
  }

  response.writeHead(204, {
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Allow-Methods": methods.join(", "),
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

async function simulatedEmail(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  await handleAuthorizedRequest(
    request,
    response,
    dependencies,
    () => {
      if (!dependencies.simulatedEmailOperation) {
        throw new Error("Simulated email operation is not configured");
      }
      return dependencies.simulatedEmailOperation.send();
    },
    202,
  );
}

async function oneDriveShareProof(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  action: "share" | "verify" | "remove",
): Promise<void> {
  await handleAuthorizedRequest(
    request,
    response,
    dependencies,
    () => {
      const operation = dependencies.oneDriveShareProofOperation;
      if (!operation) {
        throw new Error("OneDrive share proof is not configured");
      }
      return operation[action]();
    },
    action === "share" ? 201 : 200,
  );
}

async function handleAuthorizedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  operation: (caller: AuthorizedCaller) => unknown | Promise<unknown>,
  successStatus = 200,
): Promise<void> {
  const token = readBearerToken(request.headers.authorization);
  if (!token) {
    sendUnauthorized(response);
    return;
  }

  try {
    const claims = await dependencies.tokenVerifier.verify(token);
    const caller = authorizeClaims(claims, dependencies.callerPolicy);
    sendJson(response, successStatus, await operation(caller));
  } catch (error) {
    if (error instanceof CallerNotAllowedError) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (error instanceof InvalidTokenError || error instanceof InvalidClaimsError) {
      sendUnauthorized(response);
      return;
    }
    if (error instanceof OneDriveProofConflictError) {
      sendJson(response, 409, { error: "proof_state_conflict" });
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
