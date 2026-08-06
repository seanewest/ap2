import { readFileSync, realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ClientCertificateCredential } from "@azure/identity";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";
import {
  OAUTH_RECON_DETECTOR_ACTOR,
  OAUTH_RECON_MARKER,
  OAUTH_RECON_PRODUCER_ACTOR,
  OAUTH_RECON_SCENARIO_ID,
  verifyDistinctApplicationIdentityReadiness,
  type ReadyApplicationIdentityBinding,
} from "../src/validation/oauth-recon-identity-readiness.ts";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const SIGN_INS_URL =
  "https://graph.microsoft.com/beta/auditLogs/signIns";
const GRAPH_RESOURCE_ID = "00000003-0000-0000-c000-000000000000";
const DEVELOPMENT_AUTOMATION_SERVICE_PRINCIPAL_ID =
  "17dd8d61-f97f-4a8c-b601-b2a300e0c240";
const TOP = 10;
const MAX_WINDOW_MS = 15 * 60 * 1_000;

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
  servicePrincipalId: string;
  successful: boolean;
  servicePrincipal: boolean;
  resourceId: string;
}

export interface OauthReconSigninObservation {
  schema: "oauth-recon-signin-observer/v2";
  unit: "oauth-recon-signin";
  producer: "development-automation-app";
  observer: "independent-audit-observer-app";
  identitySeparated: true;
  count: number;
  observed: boolean;
  truncated: boolean;
  exactCorrelation: boolean;
  identityBindingDigestSha256: string;
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
  observerClientId: string,
  identityBinding: ReadyApplicationIdentityBinding,
  request: typeof fetch = fetch,
): Promise<OauthReconSigninObservation> {
  requireDistinctObserver(observerClientId);
  if (
    identityBinding.status !== "ready" ||
    identityBinding.scenarioId !== OAUTH_RECON_SCENARIO_ID ||
    identityBinding.roles.producer !==
      OAUTH_RECON_PRODUCER_ACTOR ||
    identityBinding.roles.detector !==
      OAUTH_RECON_DETECTOR_ACTOR ||
    identityBinding.runtimeBinding.producer.applicationId !==
      DEVELOPMENT_AUTOMATION_CLIENT_ID ||
    identityBinding.runtimeBinding.producer.servicePrincipalId !==
      DEVELOPMENT_AUTOMATION_SERVICE_PRINCIPAL_ID ||
    identityBinding.runtimeBinding.producer.tenantId !== STUDENT_TENANT_ID ||
    identityBinding.runtimeBinding.detector.applicationId !==
      observerClientId.toLowerCase() ||
    identityBinding.runtimeBinding.detector.tenantId !== STUDENT_TENANT_ID ||
    identityBinding.runtimeBinding.evidence.sourceApplicationId !==
      DEVELOPMENT_AUTOMATION_CLIENT_ID ||
    identityBinding.runtimeBinding.evidence.sourceServicePrincipalId !==
      DEVELOPMENT_AUTOMATION_SERVICE_PRINCIPAL_ID ||
    identityBinding.runtimeBinding.evidence.observerApplicationId !==
      observerClientId.toLowerCase() ||
    identityBinding.runtimeBinding.evidence.marker !== OAUTH_RECON_MARKER ||
    identityBinding.runtimeBinding.evidence.windowStart !== window.start ||
    identityBinding.runtimeBinding.evidence.windowEnd !== window.end
  ) {
    throw new Error("Exact application identity readiness is required.");
  }
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
  const exactCorrelation = observed && signIns.every(
    ({
      createdTicks,
      appId,
      servicePrincipalId,
      successful,
      servicePrincipal,
      resourceId,
    }) =>
      createdTicks >= window.startTicks &&
      createdTicks <= window.endTicks &&
      appId === DEVELOPMENT_AUTOMATION_CLIENT_ID &&
      servicePrincipalId === DEVELOPMENT_AUTOMATION_SERVICE_PRINCIPAL_ID &&
      successful &&
      servicePrincipal &&
      resourceId === GRAPH_RESOURCE_ID,
  );

  return {
    schema: "oauth-recon-signin-observer/v2",
    unit: "oauth-recon-signin",
    producer: "development-automation-app",
    observer: "independent-audit-observer-app",
    identitySeparated: true,
    count: signIns.length,
    observed,
    truncated: typeof nextLink === "string" || signIns.length === TOP,
    exactCorrelation,
    identityBindingDigestSha256:
      identityBinding.bindingDigestSha256,
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
    typeof signIn.servicePrincipalId !== "string" ||
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
    servicePrincipalId: signIn.servicePrincipalId,
    successful: status.errorCode === 0,
    servicePrincipal:
      eventTypes.length === 1 && eventTypes[0] === "servicePrincipal",
    resourceId: signIn.resourceId,
  };
}

function requireDistinctObserver(value: string): void {
  if (
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
      .test(value) ||
    value.toLowerCase() === DEVELOPMENT_AUTOMATION_CLIENT_ID
  ) {
    throw new Error(
      "Observer application identity must be a distinct canonical client ID.",
    );
  }
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

function secureJson(pathValue: string | undefined): unknown {
  try {
    if (!pathValue) throw new Error();
    const path = realpathSync(pathValue);
    if ((statSync(path).mode & 0o077) !== 0) throw new Error();
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Identity readiness configuration is invalid.");
  }
}

async function main(): Promise<void> {
  const window = argumentsFrom(process.argv.slice(2));
  const observerClientId = process.env.AP2_OBSERVER_CLIENT_ID ?? "";
  requireDistinctObserver(observerClientId);
  const identityBinding = verifyDistinctApplicationIdentityReadiness(
    secureJson(process.env.AP2_APPLICATION_IDENTITY_READINESS_PATH),
  );
  if (identityBinding.status !== "ready") {
    throw new Error("Exact application identity readiness is required.");
  }
  const credential = new ClientCertificateCredential(
    STUDENT_TENANT_ID,
    observerClientId,
    secureCertificatePath(process.env.AP2_OBSERVER_CERTIFICATE_PATH),
  );
  console.log(
    JSON.stringify(
      await observeOauthReconSignin(
        window,
        credential,
        observerClientId,
        identityBinding,
      ),
      null,
      2,
    ),
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
