import fs from "node:fs";
import path from "node:path";
import { ClientCertificateCredential } from "@azure/identity";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

const TENANT_ID = "92563293-315c-4b6c-9b90-bcb47ee8c970";
const RACHEL_ID = "1e99b11d-f3b0-4e6f-86b5-1b4bf95012e9";
const RACHEL_UPN = "rachel.green@corywest.onmicrosoft.com";
const RACHEL_DEVICE_ID = "732767fb-a200-48bf-af95-817ed3906d76";
const TLS_POLICY_ID = "bd9e2402-728d-4539-a5f3-5ec8b130e03d";
const TLS_RULE_ID = "25d2a7ac-6d20-490d-90b2-2f50304ca79c";
const RUN_ID = process.env.AP2_RUN_ID?.trim();
if (!/^AP2-RACHEL-CHAIN-[0-9]{8}T[0-9]{6}Z$/.test(RUN_ID ?? "")) {
  throw new Error("AP2_RUN_ID must be AP2-RACHEL-CHAIN-YYYYMMDDTHHMMSSZ");
}
const MODE = process.argv[2];
if (!new Set(["observe", "final"]).has(MODE)) throw new Error("mode must be observe or final");
const METHOD_NAME = RUN_ID.slice(0, 30);
const runTimestamp = RUN_ID.match(/([0-9]{8}T[0-9]{6}Z)$/)[1];
const runStart = `${runTimestamp.slice(0, 4)}-${runTimestamp.slice(4, 6)}-${runTimestamp.slice(6, 8)}T${runTimestamp.slice(9, 11)}:${runTimestamp.slice(11, 13)}:${runTimestamp.slice(13, 15)}Z`;

const runtime = resolveAp2RuntimeRoot();
const output = path.join(runtime, "runs", RUN_ID);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const config = JSON.parse(fs.readFileSync(path.join(runtime, "secrets/dev-graph/config.json"), "utf8"));
if (config.tenantId !== TENANT_ID) throw new Error("Dev credential is not bound to the Student tenant");
const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
  certificatePath: path.join(runtime, "secrets/dev-graph/credential.pem"),
});
const token = (await credential.getToken("https://graph.microsoft.com/.default"))?.token;
if (!token) throw new Error("Graph token acquisition failed");

async function graph(pathname, init = {}) {
  const response = await fetch(`https://graph.microsoft.com${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${pathname} -> ${response.status} ${body?.error?.code ?? "unknown"}`);
  return body;
}

async function hunt(query) {
  const result = await graph("/v1.0/security/runHuntingQuery", {
    method: "POST",
    body: JSON.stringify({ Query: query, Timespan: "P1D" }),
  });
  if (!Array.isArray(result.results)) throw new Error("Advanced hunting response was malformed");
  return result.results;
}

const processQuery = `DeviceProcessEvents
| where Timestamp >= datetime(${runStart})
| where DeviceName startswith "ap2fastrachel"
| where FileName =~ "msedge.exe" and ProcessCommandLine has "${RUN_ID}"
| project Timestamp,DeviceId,DeviceName,AccountUpn,AccountName,AccountDomain,AccountSid,LogonId,ProcessId,FileName,FolderPath,ProcessCommandLine,InitiatingProcessFileName,InitiatingProcessAccountUpn,ReportId`;
const networkQuery = `DeviceNetworkEvents
| where Timestamp >= datetime(${runStart})
| where DeviceName startswith "ap2fastrachel"
| where RemoteUrl has "seanewest.github.io" and InitiatingProcessFileName =~ "msedge.exe"
| project Timestamp,DeviceId,DeviceName,ActionType,RemoteUrl,RemoteIP,RemotePort,Protocol,LocalIP,InitiatingProcessAccountUpn,InitiatingProcessAccountName,InitiatingProcessAccountDomain,InitiatingProcessAccountSid,InitiatingProcessId,InitiatingProcessCommandLine,ReportId`;

const filter = encodeURIComponent(`userPrincipalName eq '${RACHEL_UPN}' and createdDateTime ge ${runStart} and destinationFQDN eq 'seanewest.github.io'`);
const [methods, targetedAudits, recentAudits, signIns, traffic, processRows, networkRows] = await Promise.all([
  graph(`/v1.0/users/${RACHEL_ID}/authentication/methods`),
  graph(`/v1.0/auditLogs/directoryAudits?$filter=targetResources/any(t:t/id%20eq%20%27${RACHEL_ID}%27)&$orderby=activityDateTime%20desc&$top=50`),
  graph(`/v1.0/auditLogs/directoryAudits?$filter=activityDateTime%20ge%20${encodeURIComponent(runStart)}&$orderby=activityDateTime%20desc&$top=150`),
  graph(`/beta/auditLogs/signIns?$filter=userId%20eq%20%27${RACHEL_ID}%27%20and%20createdDateTime%20ge%20${encodeURIComponent(runStart)}&$orderby=createdDateTime%20desc&$top=200`),
  graph(`/beta/networkAccess/logs/traffic?$filter=${filter}&$orderby=createdDateTime%20desc&$top=100`, { headers: { Prefer: "include-unknown-enum-members" } }),
  hunt(processQuery),
  hunt(networkQuery),
]);

const audits = [...targetedAudits.value, ...recentAudits.value]
  .filter((audit, index, values) => values.findIndex((candidate) => candidate.id === audit.id) === index)
  .filter((audit) =>
    Date.parse(audit.activityDateTime) >= Date.parse(runStart) &&
    /security info|passkey|authentication method|fido/i.test(`${audit.activityDisplayName} ${audit.resultReason}`) &&
    (audit.initiatedBy?.user?.id === RACHEL_ID || audit.targetResources?.some((target) => target.id === RACHEL_ID))
  )
  .map((audit) => ({
    id: audit.id,
    activityDateTime: audit.activityDateTime,
    activityDisplayName: audit.activityDisplayName,
    result: audit.result,
    resultReason: audit.resultReason,
    loggedByService: audit.loggedByService,
    correlationId: audit.correlationId,
    initiatedBy: audit.initiatedBy?.user && {
      id: audit.initiatedBy.user.id,
      userPrincipalName: audit.initiatedBy.user.userPrincipalName,
    },
  }));
const sanitizedSignIns = signIns.value.map((entry) => ({
  id: entry.id,
  createdDateTime: entry.createdDateTime,
  userId: entry.userId,
  userPrincipalName: entry.userPrincipalName,
  appDisplayName: entry.appDisplayName,
  resourceDisplayName: entry.resourceDisplayName,
  ipAddress: entry.ipAddress,
  userAgent: entry.userAgent,
  clientAppUsed: entry.clientAppUsed,
  isInteractive: entry.isInteractive,
  status: entry.status,
  authenticationRequirement: entry.authenticationRequirement,
  authenticationDetails: entry.authenticationDetails?.map((detail) => ({
    authenticationMethod: detail.authenticationMethod,
    authenticationMethodDetail: detail.authenticationMethodDetail,
    succeeded: detail.succeeded,
    authenticationStepDateTime: detail.authenticationStepDateTime,
    authenticationStepResultDetail: detail.authenticationStepResultDetail,
  })),
  conditionalAccessStatus: entry.conditionalAccessStatus,
  deviceDetail: entry.deviceDetail,
  isThroughGlobalSecureAccess: entry.isThroughGlobalSecureAccess,
  globalSecureAccessIpAddress: entry.globalSecureAccessIpAddress,
  correlationId: entry.correlationId,
}));
const sanitizedTraffic = traffic.value.map((entry) => ({
  transactionId: entry.transactionId,
  createdDateTime: entry.createdDateTime,
  userPrincipalName: entry.userPrincipalName,
  userId: entry.userId,
  deviceId: entry.deviceId,
  deviceOperatingSystem: entry.deviceOperatingSystem,
  agentVersion: entry.agentVersion,
  destinationFQDN: entry.destinationFQDN,
  destinationUrl: entry.destinationUrl,
  action: entry.action,
  operationStatus: entry.operationStatus,
  initiatingProcessName: entry.initiatingProcessName,
  httpMethod: entry.httpMethod,
  responseCode: entry.responseCode,
  tlsDetails: entry.tlsDetails,
  popProcessingRegion: entry.popProcessingRegion,
}));
const sanitizedMethods = methods.value.map((method) => ({
  id: method.id,
  type: method["@odata.type"],
  displayName: method.displayName,
  model: method.model,
  createdDateTime: method.createdDateTime,
}));

const exactPasskey = sanitizedMethods.filter((method) =>
  method.type === "#microsoft.graph.fido2AuthenticationMethod" && method.displayName === METHOD_NAME
);
const actualPageTraffic = sanitizedTraffic.filter((entry) =>
  entry.destinationUrl === "https://seanewest.github.io/ap2/company-access.html" &&
  entry.userId === RACHEL_ID && entry.deviceId === RACHEL_DEVICE_ID &&
  entry.initiatingProcessName === "msedge.exe" && entry.httpMethod?.toLowerCase() === "get" &&
  entry.responseCode === 200 && entry.tlsDetails?.action === "intercepted" &&
  entry.tlsDetails?.status === "success" && entry.tlsDetails?.policyId === TLS_POLICY_ID &&
  entry.tlsDetails?.ruleId === TLS_RULE_ID
);
const registrationAudits = audits.filter((audit) =>
  audit.initiatedBy?.id === RACHEL_ID && audit.result === "success" &&
  /registered.*(?:passkey|fido)|registered.*security info.*(?:passkey|fido)|(?:passkey|fido).*registered/i.test(
    `${audit.activityDisplayName} ${audit.resultReason}`,
  )
);
const deletionAudits = audits.filter((audit) =>
  audit.initiatedBy?.id === RACHEL_ID && audit.result === "success" &&
  /deleted.*(?:passkey|fido)|deleted.*security info.*(?:passkey|fido)|(?:passkey|fido).*deleted/i.test(
    `${audit.activityDisplayName} ${audit.resultReason}`,
  )
);
const distinctSignIns = sanitizedSignIns.filter((entry) =>
  entry.userId === RACHEL_ID && /Linux/i.test(entry.deviceDetail?.operatingSystem ?? "") &&
  /Chrome/i.test(entry.deviceDetail?.browser ?? entry.userAgent ?? "") && !entry.deviceDetail?.deviceId &&
  /After Party Exploratory|Microsoft Account Controls/i.test(entry.appDisplayName)
);
const afterPartyX509 = distinctSignIns.filter((entry) =>
  entry.appDisplayName === "After Party Exploratory" && entry.authenticationDetails?.some((detail) =>
    /X\.509 Certificate/i.test(detail.authenticationMethod ?? "") && detail.succeeded === true
  )
);
const accountControlSuccess = distinctSignIns.filter((entry) =>
  /Microsoft Account Controls/i.test(entry.appDisplayName) && entry.status?.errorCode === 0
);
const exactProcesses = processRows.filter((entry) =>
  String(entry.ProcessCommandLine).includes(RUN_ID) && String(entry.AccountUpn).toLowerCase() === RACHEL_UPN
);
const exactNetworks = networkRows.filter((entry) =>
  String(entry.RemoteUrl).toLowerCase().includes("seanewest.github.io") &&
  (String(entry.InitiatingProcessAccountUpn).toLowerCase() === RACHEL_UPN ||
    String(entry.InitiatingProcessAccountName).toLowerCase() === "rachelgreen")
);

if (MODE === "observe" && (
  exactPasskey.length !== 1 || actualPageTraffic.length < 1 || registrationAudits.length < 1 ||
  accountControlSuccess.length < 1 || exactProcesses.length < 1
)) {
  throw new Error(`Native evidence is incomplete: ${JSON.stringify({
    passkeys: exactPasskey.length,
    actualPageTraffic: actualPageTraffic.length,
    registrationAudits: registrationAudits.length,
    distinctSignIns: distinctSignIns.length,
    afterPartyX509: afterPartyX509.length,
    accountControlSuccess: accountControlSuccess.length,
    processRows: exactProcesses.length,
    networkRows: exactNetworks.length,
    rawNetworkRows: networkRows.length,
  })}`);
}
if (MODE === "final" && sanitizedMethods.some((method) => method.type === "#microsoft.graph.fido2AuthenticationMethod")) {
  throw new Error("Rachel FIDO2 method remains after cleanup");
}
if (MODE === "final" && deletionAudits.length < 1) {
  throw new Error("Rachel-attributed FIDO2 deletion audit has not propagated");
}

const evidence = {
  observedUtc: new Date().toISOString(),
  runId: RUN_ID,
  mode: MODE,
  native: {
    endpoint: { processRows: exactProcesses, networkRows: exactNetworks },
    gsa: actualPageTraffic,
    entra: { methods: sanitizedMethods, authenticationMethodAudits: audits, signIns: sanitizedSignIns },
  },
};
const file = path.join(output, MODE === "observe" ? "native-evidence.json" : "final-native-state.json");
fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  observedUtc: evidence.observedUtc,
  mode: MODE,
  counts: {
    exactPasskeys: exactPasskey.length,
    endpointProcesses: exactProcesses.length,
    endpointNetworks: exactNetworks.length,
    gsaActualPage: actualPageTraffic.length,
    registrationAudits: registrationAudits.length,
    deletionAudits: deletionAudits.length,
    distinctSignIns: distinctSignIns.length,
    afterPartyX509: afterPartyX509.length,
    accountControlSuccess: accountControlSuccess.length,
  },
  protectedFile: file,
}, null, 2));
