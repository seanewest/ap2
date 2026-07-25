import { realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ClientCertificateCredential } from "@azure/identity";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const SIGN_INS_URL =
  "https://graph.microsoft.com/beta/auditLogs/signIns";
const GRAPH_RESOURCE_ID = "00000003-0000-0000-c000-000000000000";
const TOP = 10;
const MAX_WINDOW_MS = 15 * 60 * 1_000;

export const OAUTH_RECON_SIGNIN_CONFIGURATION = {
  tenantId: STUDENT_TENANT_ID,
  clientId: DEVELOPMENT_AUTOMATION_CLIENT_ID,
} as const;

interface GraphCredential {
  getToken(scope: string): Promise<{ token: string } | null>;
}

interface Window {
  start: string;
  end: string;
  startTicks: bigint;
  endTicks: bigint;
}

interface SignIn {
  createdTicks: bigint;
  appId: string;
  successful: boolean;
  servicePrincipal: boolean;
  resourceId: string;
}

export interface OauthReconSigninObservation {
  schema: "oauth-recon-signin-observer/v1";
  unit: "oauth-recon-signin";
  observer: "development-automation-app";
  count: number;
  observed: boolean;
  truncated: boolean;
  allMatchesInWindow: boolean;
  allMatchesExactApp: boolean;
  allMatchesSuccessful: boolean;
  allMatchesServicePrincipal: boolean;
  allMatchesGraphResource: boolean;
}

export function requiredObservationWindow(
  start: string,
  end: string,
): Window {
  const startTicks = canonicalArgumentTicks(start);
  const endTicks = canonicalArgumentTicks(end);
  if (startTicks > endTicks) {
    throw new Error("The observer window start must not follow its end.");
  }
  if (Date.parse(end) - Date.parse(start) > MAX_WINDOW_MS) {
    throw new Error("The observer window must not exceed 15 minutes.");
  }
  return { start, end, startTicks, endTicks };
}

export async function observeOauthReconSignin(
  window: Window,
  credential: GraphCredential,
  request: typeof fetch = fetch,
): Promise<OauthReconSigninObservation> {
  let access: { token: string } | null;
  try {
    access = await credential.getToken(GRAPH_SCOPE);
  } catch {
    throw new Error("Observer authentication failed.");
  }
  if (!access?.token) {
    throw new Error("Observer authentication failed.");
  }

  let response: Response;
  try {
    response = await request(observationUrl(window), {
      method: "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${access.token}` },
    });
  } catch {
    throw new Error("Observer transport failed.");
  }
  if (response.status !== 200) {
    throw new Error(`Observer request failed with HTTP ${response.status}.`);
  }

  const body = await response.json().catch(() => undefined);
  const record = asRecord(body);
  if (!Array.isArray(record?.value) || record.value.length > TOP) {
    throw new Error("Observer response was malformed.");
  }
  const nextLink = record["@odata.nextLink"];
  if (nextLink !== undefined && typeof nextLink !== "string") {
    throw new Error("Observer response was malformed.");
  }
  const signIns = record.value.map(parseSignIn);
  const observed = signIns.length > 0;

  return {
    schema: "oauth-recon-signin-observer/v1",
    unit: "oauth-recon-signin",
    observer: "development-automation-app",
    count: signIns.length,
    observed,
    truncated: typeof nextLink === "string" || signIns.length === TOP,
    allMatchesInWindow: observed && signIns.every(
      ({ createdTicks }) =>
        createdTicks >= window.startTicks && createdTicks <= window.endTicks,
    ),
    allMatchesExactApp: observed && signIns.every(
      ({ appId }) => appId === DEVELOPMENT_AUTOMATION_CLIENT_ID,
    ),
    allMatchesSuccessful: observed &&
      signIns.every(({ successful }) => successful),
    allMatchesServicePrincipal: observed && signIns.every(
      ({ servicePrincipal }) => servicePrincipal,
    ),
    allMatchesGraphResource: observed && signIns.every(
      ({ resourceId }) => resourceId === GRAPH_RESOURCE_ID,
    ),
  };
}

function observationUrl(window: Window): URL {
  const url = new URL(SIGN_INS_URL);
  url.searchParams.set("$top", String(TOP));
  url.searchParams.set(
    "$filter",
    `appId eq '${DEVELOPMENT_AUTOMATION_CLIENT_ID}' and ` +
      `createdDateTime ge ${window.start} and ` +
      `createdDateTime le ${window.end} and ` +
      "signInEventTypes/any(t:t eq 'servicePrincipal')",
  );
  return url;
}

function parseSignIn(value: unknown): SignIn {
  const signIn = asRecord(value);
  const status = asRecord(signIn?.status);
  const eventTypes = signIn?.signInEventTypes;
  const createdTicks = utcTicks(signIn?.createdDateTime);
  if (
    !signIn ||
    !status ||
    createdTicks === undefined ||
    typeof signIn.appId !== "string" ||
    !Number.isSafeInteger(status.errorCode) ||
    !Array.isArray(eventTypes) ||
    !eventTypes.every((eventType) => typeof eventType === "string") ||
    typeof signIn.resourceId !== "string"
  ) {
    throw new Error("Observer response was malformed.");
  }
  return {
    createdTicks,
    appId: signIn.appId,
    successful: status.errorCode === 0,
    servicePrincipal:
      eventTypes.length === 1 && eventTypes[0] === "servicePrincipal",
    resourceId: signIn.resourceId,
  };
}

function canonicalArgumentTicks(value: string): bigint {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    throw new Error("The observer window must use canonical UTC instants.");
  }
  return utcTicks(value) as bigint;
}

function utcTicks(value: unknown): bigint | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?Z$/
      .exec(value);
  if (!match?.[1]) {
    return undefined;
  }
  const wholeSecondMs = Date.parse(`${match[1]}Z`);
  if (
    !Number.isFinite(wholeSecondMs) ||
    new Date(wholeSecondMs).toISOString().slice(0, 19) !== match[1]
  ) {
    return undefined;
  }
  const fraction = match[2] ?? "";
  return BigInt(wholeSecondMs) * 10_000n +
    BigInt(fraction.padEnd(7, "0") || "0");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function argumentsFrom(args: readonly string[]): Window {
  if (
    args.length !== 4 ||
    args[0] !== "--start" ||
    !args[1] ||
    args[2] !== "--end" ||
    !args[3]
  ) {
    throw new Error(
      "Usage: --start <canonical UTC> --end <canonical UTC>",
    );
  }
  return requiredObservationWindow(args[1], args[3]);
}

function secureCertificatePath(configured: string | undefined): string {
  try {
    if (!configured) {
      throw new Error();
    }
    const path = realpathSync(configured);
    if ((statSync(path).mode & 0o077) !== 0) {
      throw new Error();
    }
    return path;
  } catch {
    throw new Error("Observer certificate configuration is invalid.");
  }
}

async function main(): Promise<void> {
  const window = argumentsFrom(process.argv.slice(2));
  const credential = new ClientCertificateCredential(
    STUDENT_TENANT_ID,
    DEVELOPMENT_AUTOMATION_CLIENT_ID,
    secureCertificatePath(process.env.AP2_AUTOMATION_CERTIFICATE_PATH),
  );
  console.log(
    JSON.stringify(await observeOauthReconSignin(window, credential), null, 2),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "OAuth recon observer failed.",
    );
    process.exitCode = 1;
  });
}
