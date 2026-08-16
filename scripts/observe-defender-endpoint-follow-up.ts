import { readFileSync, realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ClientCertificateCredential } from "@azure/identity";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const MDE_SCOPE = "https://api.securitycenter.microsoft.com/.default";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const MDE_ROOT = "https://api.securitycenter.microsoft.com/api";
const MAX_WINDOW_MS = 6 * 60 * 60 * 1_000;
const GRAPH_ALERT_CAP = 200;
const GRAPH_INCIDENT_CAP = 50;

interface Credential {
  getToken(scope: string): Promise<{ token: string } | null>;
}

export interface DefenderEndpointFollowUp {
  start: string;
  end: string;
  deviceName: string;
  machineId: string;
  sha256: string;
  runId: string;
}

export interface DefenderEndpointFollowUpObservation {
  schema: "defender-endpoint-follow-up/v1";
  window: { start: string; end: string };
  counts: {
    mdeMachineAlerts: number;
    graphAlerts: number;
    graphIncidents: number;
    alertInfo: number;
    exactAlertEvidence: number;
  };
  truncated: {
    graphAlerts: boolean;
    graphIncidents: boolean;
  };
  limitations: {
    maxClosedWindowHours: 6;
    graphHuntingTimespan: "P1D";
    rawDeviceHuntingTablesQueried: false;
    deviceTimelineQueried: false;
    legacyMdeAdvancedQueryQueried: false;
  };
}

/**
 * Recover the supported, read-only portion of archived W48's query shape.
 * This observer is intentionally limited to alert-centric data. W48 found the
 * raw Device* hunting tables unavailable in the authorized Graph schema and
 * the legacy MDE advanced-query endpoint unavailable without
 * AdvancedQuery.Read.All. Empty counts here must not be described as absence
 * of raw device events or proof that the sensor observed the activity.
 */
export async function observeDefenderEndpointFollowUp(
  input: DefenderEndpointFollowUp,
  graphCredential: Credential,
  mdeCredential: Credential,
  request: typeof fetch = fetch,
): Promise<DefenderEndpointFollowUpObservation> {
  const target = validateInput(input);
  const [graphAccess, mdeAccess] = await Promise.all([
    tokenFor(graphCredential, GRAPH_SCOPE),
    tokenFor(mdeCredential, MDE_SCOPE),
  ]);

  const [mdeAlerts, graphAlerts, graphIncidents, alertInfo, alertEvidence] =
    await Promise.all([
      getJson(
        `${MDE_ROOT}/machines/${target.machineId}/alerts`,
        mdeAccess,
        request,
      ),
      getJson(graphAlertsUrl(target), graphAccess, request),
      getJson(graphIncidentsUrl(target), graphAccess, request),
      hunt(alertInfoQuery(target), graphAccess, request),
      hunt(alertEvidenceQuery(target), graphAccess, request),
    ]);

  const mdeRows = listValue(mdeAlerts, "MDE machine alerts");
  const graphAlertRows = listValue(graphAlerts, "Graph alerts");
  const graphIncidentRows = listValue(graphIncidents, "Graph incidents");
  const alertInfoRows = huntingResults(alertInfo, "AlertInfo");
  const alertEvidenceRows = huntingResults(alertEvidence, "AlertEvidence");

  return {
    schema: "defender-endpoint-follow-up/v1",
    window: { start: target.start, end: target.end },
    counts: {
      mdeMachineAlerts: mdeRows.filter((value) =>
        timestampInWindow(value, "alertCreationTime", target)
      ).length,
      graphAlerts: graphAlertRows.length,
      graphIncidents: graphIncidentRows.length,
      alertInfo: alertInfoRows.length,
      exactAlertEvidence: alertEvidenceRows.length,
    },
    truncated: {
      graphAlerts:
        hasNextLink(graphAlerts) || graphAlertRows.length === GRAPH_ALERT_CAP,
      graphIncidents:
        hasNextLink(graphIncidents) ||
        graphIncidentRows.length === GRAPH_INCIDENT_CAP,
    },
    limitations: {
      maxClosedWindowHours: 6,
      graphHuntingTimespan: "P1D",
      rawDeviceHuntingTablesQueried: false,
      deviceTimelineQueried: false,
      legacyMdeAdvancedQueryQueried: false,
    },
  };
}

export function alertInfoQuery(input: DefenderEndpointFollowUp): string {
  const value = validateInput(input);
  return `AlertInfo | where Timestamp between (datetime(${value.start}) .. datetime(${value.end})) | project Timestamp,AlertId,Title,Category,Severity,ServiceSource,DetectionSource`;
}

export function alertEvidenceQuery(input: DefenderEndpointFollowUp): string {
  const value = validateInput(input);
  return `AlertEvidence | where Timestamp between (datetime(${value.start}) .. datetime(${value.end})) | where DeviceName startswith "${value.deviceName}" or SHA256 =~ "${value.sha256}" or ProcessCommandLine has "${value.runId}" | project Timestamp,AlertId,Title,EntityType,EvidenceRole,DeviceId,DeviceName,AccountName,AccountDomain,AccountSid,FileName,FolderPath,ProcessCommandLine,SHA1,SHA256,RemoteIP,RemoteUrl`;
}

function graphAlertsUrl(input: DefenderEndpointFollowUp): URL {
  const url = new URL(`${GRAPH_ROOT}/security/alerts_v2`);
  url.searchParams.set(
    "$filter",
    `createdDateTime ge ${input.start} and createdDateTime le ${input.end}`,
  );
  url.searchParams.set("$top", String(GRAPH_ALERT_CAP));
  return url;
}

function graphIncidentsUrl(input: DefenderEndpointFollowUp): URL {
  const url = new URL(`${GRAPH_ROOT}/security/incidents`);
  url.searchParams.set(
    "$filter",
    `lastUpdateDateTime ge ${input.start} and lastUpdateDateTime le ${input.end}`,
  );
  url.searchParams.set("$top", String(GRAPH_INCIDENT_CAP));
  return url;
}

async function hunt(
  query: string,
  token: string,
  request: typeof fetch,
): Promise<unknown> {
  return getJson(
    `${GRAPH_ROOT}/security/runHuntingQuery`,
    token,
    request,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Query: query, Timespan: "P1D" }),
    },
  );
}

async function tokenFor(
  credential: Credential,
  scope: string,
): Promise<string> {
  try {
    const access = await credential.getToken(scope);
    if (access?.token) return access.token;
  } catch {
    // Keep authentication failures free of credential-provider detail.
  }
  throw new Error("Defender follow-up authentication failed.");
}

async function getJson(
  input: string | URL,
  token: string,
  request: typeof fetch,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await request(input, {
      ...init,
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
  } catch {
    throw new Error("Defender follow-up transport failed.");
  }
  if (response.status !== 200) {
    throw new Error(`Defender follow-up request failed with HTTP ${response.status}.`);
  }
  return response.json().catch(() => {
    throw new Error("Defender follow-up response was malformed.");
  });
}

function listValue(value: unknown, label: string): unknown[] {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.value)) {
    throw new Error(`${label} response was malformed.`);
  }
  return record.value;
}

function huntingResults(value: unknown, label: string): unknown[] {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.results)) {
    throw new Error(`${label} response was malformed.`);
  }
  return record.results;
}

function hasNextLink(value: unknown): boolean {
  const next = asRecord(value)?.["@odata.nextLink"];
  if (next !== undefined && typeof next !== "string") {
    throw new Error("Defender follow-up response was malformed.");
  }
  return typeof next === "string";
}

function timestampInWindow(
  value: unknown,
  field: string,
  window: DefenderEndpointFollowUp,
): boolean {
  const timestamp = asRecord(value)?.[field];
  if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error("MDE machine alerts response was malformed.");
  }
  const ticks = Date.parse(timestamp);
  return ticks >= Date.parse(window.start) && ticks <= Date.parse(window.end);
}

function validateInput(
  input: DefenderEndpointFollowUp,
): DefenderEndpointFollowUp {
  const start = canonicalUtc(input.start, "start");
  const end = canonicalUtc(input.end, "end");
  if (Date.parse(start) > Date.parse(end)) {
    throw new Error("The follow-up window start must not follow its end.");
  }
  if (Date.parse(end) - Date.parse(start) > MAX_WINDOW_MS) {
    throw new Error("The follow-up window must not exceed six hours.");
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/i.test(input.deviceName)) {
    throw new Error("The device name is invalid.");
  }
  if (!/^[a-f0-9]{40}$/i.test(input.machineId)) {
    throw new Error("The MDE machine ID is invalid.");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.sha256)) {
    throw new Error("The marker SHA-256 is invalid.");
  }
  if (!/^[a-z0-9][a-z0-9._:-]{0,126}[a-z0-9]$/i.test(input.runId)) {
    throw new Error("The run ID is invalid.");
  }
  return { ...input, start, end };
}

function canonicalUtc(value: string, label: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    throw new Error(`The follow-up ${label} must be a canonical UTC instant.`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function argumentsFrom(args: readonly string[]): DefenderEndpointFollowUp {
  const names = [
    "--start",
    "--end",
    "--device-name",
    "--machine-id",
    "--sha256",
    "--run-id",
  ];
  if (args.length !== names.length * 2) throw new Error(usage());
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name || !names.includes(name) || !value || values.has(name)) {
      throw new Error(usage());
    }
    values.set(name, value);
  }
  return validateInput({
    start: values.get("--start") ?? "",
    end: values.get("--end") ?? "",
    deviceName: values.get("--device-name") ?? "",
    machineId: values.get("--machine-id") ?? "",
    sha256: values.get("--sha256") ?? "",
    runId: values.get("--run-id") ?? "",
  });
}

function usage(): string {
  return "Usage: --start <UTC> --end <UTC> --device-name <name> --machine-id <40-hex ID> --sha256 <64-hex hash> --run-id <marker>";
}

function secureConfig(pathValue: string | undefined): {
  tenantId: string;
  clientId: string;
  certificatePath: string;
} {
  try {
    if (!pathValue) throw new Error();
    const path = realpathSync(pathValue);
    if ((statSync(path).mode & 0o077) !== 0) throw new Error();
    const value = asRecord(JSON.parse(readFileSync(path, "utf8")));
    if (
      !value ||
      typeof value.tenantId !== "string" ||
      typeof value.clientId !== "string" ||
      typeof value.certificatePath !== "string"
    ) throw new Error();
    const certificatePath = realpathSync(value.certificatePath);
    if ((statSync(certificatePath).mode & 0o077) !== 0) throw new Error();
    return {
      tenantId: value.tenantId,
      clientId: value.clientId,
      certificatePath,
    };
  } catch {
    throw new Error("Defender follow-up credential configuration is invalid.");
  }
}

async function main(): Promise<void> {
  const input = argumentsFrom(process.argv.slice(2));
  const config = secureConfig(process.env.AP2_DEFENDER_CONFIG_PATH);
  const credential = new ClientCertificateCredential(
    config.tenantId,
    config.clientId,
    { certificatePath: config.certificatePath },
  );
  console.log(JSON.stringify(
    await observeDefenderEndpointFollowUp(
      input,
      credential,
      credential,
    ),
    null,
    2,
  ));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Defender follow-up failed.",
    );
    process.exitCode = 1;
  });
}
