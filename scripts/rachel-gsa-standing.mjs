import fs from "node:fs";
import path from "node:path";
import { ClientCertificateCredential } from "@azure/identity";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

const TENANT_ID = "92563293-315c-4b6c-9b90-bcb47ee8c970";
const RACHEL_ID = "1e99b11d-f3b0-4e6f-86b5-1b4bf95012e9";
const RACHEL_UPN = "rachel.green@corywest.onmicrosoft.com";
const INTERNET_PROFILE_ID = "30c157cf-f64e-4520-99e0-fe32a2dd01fc";
const INTERNET_PROFILE_SP_ID = "7560b19f-6b50-45c9-88da-f10b5c391c23";
const INTERNET_PROFILE_SP_NAME = "GSA-Internettrafficforwardingprofile";
const DEFAULT_APP_ROLE_ID = "00000000-0000-0000-0000-000000000000";
const ENTRA_SUITE_SKU_ID = "f9602137-2203-447b-9fff-41b36e08ce5d";
const INTERNET_ACCESS_PLAN_ID = "8d23cb83-ab07-418f-8517-d7aca77307dc";
const INSTALLER_URL = "https://aka.ms/GlobalSecureAccess-Windows";
const MODE = process.argv[2];
const SINCE = process.argv[3];
const DESTINATION_FQDN = process.argv[4];

if (!new Set(["inspect", "assign", "install", "guest", "traffic"]).has(MODE)) {
  throw new Error("mode must be inspect, assign, install, guest, or traffic");
}

const runtime = resolveAp2RuntimeRoot();
const config = JSON.parse(fs.readFileSync(path.join(runtime, "secrets/dev-graph/config.json"), "utf8"));
if (config.tenantId !== TENANT_ID) throw new Error("Dev credential is not bound to the Student tenant");
const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
  certificatePath: path.join(runtime, "secrets/dev-graph/credential.pem"),
});
const graphToken = (await credential.getToken("https://graph.microsoft.com/.default"))?.token;
const armToken = (await credential.getToken("https://management.azure.com/.default"))?.token;
if (!graphToken || !armToken) throw new Error("Protected credential could not obtain Graph and ARM tokens");

const subscription = `/subscriptions/${config.subscriptionId}`;
const vm = `${subscription}/resourceGroups/rg-ap2-avd-fast-rachel/providers/Microsoft.Compute/virtualMachines/ap2fastrachel-vm`;
const host = `${subscription}/resourceGroups/rg-ap2-avd-fast-rachel/providers/Microsoft.DesktopVirtualization/hostPools/ap2fastrachel-hp/sessionHosts/ap2fastrachel`;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(origin, token, pathname, init = {}, accepted = []) {
  const response = await fetch(pathname.startsWith("http") ? pathname : `${origin}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { text: text.slice(0, 800) }; }
  if (!response.ok && !accepted.includes(response.status)) {
    throw new Error(`${init.method ?? "GET"} ${pathname} -> ${response.status} ${body?.error?.code ?? "unknown"}`);
  }
  return { response, body };
}

const graph = (pathname, init, accepted) => request("https://graph.microsoft.com", graphToken, pathname, init, accepted);
const arm = (pathname, init, accepted) => request("https://management.azure.com", armToken, pathname, init, accepted);

async function avdState() {
  const [instance, sessionHost, sessions] = await Promise.all([
    arm(`${vm}/instanceView?api-version=2024-11-01`).then(({ body }) => body),
    arm(`${host}?api-version=2024-04-03`).then(({ body }) => body),
    arm(`${host}/userSessions?api-version=2024-04-03`).then(({ body }) => body.value ?? []),
  ]);
  return {
    power: instance.statuses?.find((entry) => entry.code?.startsWith("PowerState/"))?.code,
    hostStatus: sessionHost.properties?.status,
    assignedUser: sessionHost.properties?.assignedUser,
    declaredSessions: sessionHost.properties?.sessions,
    sessions: sessions.map((entry) => ({
      name: entry.name,
      userPrincipalName: entry.properties?.userPrincipalName,
      sessionState: entry.properties?.sessionState,
    })),
  };
}

async function standingState() {
  const [profile, servicePrincipal, assigned, user, subscribedSkus, policies, endpoint] = await Promise.all([
    graph(`/beta/networkAccess/forwardingProfiles/${INTERNET_PROFILE_ID}`),
    graph(`/v1.0/servicePrincipals/${INTERNET_PROFILE_SP_ID}?$select=id,appId,displayName,accountEnabled,appRoleAssignmentRequired`),
    graph(`/v1.0/servicePrincipals/${INTERNET_PROFILE_SP_ID}/appRoleAssignedTo`),
    graph(`/v1.0/users/${RACHEL_ID}?$select=id,userPrincipalName,accountEnabled,assignedLicenses,licenseAssignmentStates`),
    graph("/v1.0/subscribedSkus"),
    graph("/v1.0/identity/conditionalAccess/policies?$select=id,displayName,state"),
    avdState(),
  ]);
  const assignment = assigned.body.value?.find((entry) => entry.principalId === RACHEL_ID);
  const suite = subscribedSkus.body.value?.find((entry) => entry.skuId === ENTRA_SUITE_SKU_ID);
  const suiteAssignment = user.body.assignedLicenses?.find((entry) => entry.skuId === ENTRA_SUITE_SKU_ID);
  const boundaryPolicyIds = new Set([
    "fe9e0dfa-06b8-433c-9c89-23d9b1345334",
    "ad0f2a27-e0c6-4f54-b23f-9adcb8f08da7",
    "fda244bc-08d9-464e-b225-2e38256bdbcb",
    "9ee37be3-2941-4045-908a-282cbd267131",
    "083bbb56-e8a3-4382-aca2-78b463e1d3db",
  ]);
  const retainedPolicies = policies.body.value?.filter((entry) => boundaryPolicyIds.has(entry.id)) ?? [];
  return {
    observedUtc: new Date().toISOString(),
    profile: {
      id: profile.body.id,
      name: profile.body.name,
      trafficForwardingType: profile.body.trafficForwardingType,
      state: profile.body.state,
      version: profile.body.version,
    },
    assignment: assignment && {
      id: assignment.id,
      principalId: assignment.principalId,
      principalDisplayName: assignment.principalDisplayName,
      principalType: assignment.principalType,
      resourceId: assignment.resourceId,
      resourceDisplayName: assignment.resourceDisplayName,
      appRoleId: assignment.appRoleId,
      createdDateTime: assignment.createdDateTime,
    },
    profileServicePrincipal: {
      id: servicePrincipal.body.id,
      displayName: servicePrincipal.body.displayName,
      accountEnabled: servicePrincipal.body.accountEnabled,
      appRoleAssignmentRequired: servicePrincipal.body.appRoleAssignmentRequired,
    },
    rachel: {
      id: user.body.id,
      userPrincipalName: user.body.userPrincipalName,
      accountEnabled: user.body.accountEnabled,
      activeLicenseCount: user.body.licenseAssignmentStates?.filter((entry) => entry.state === "Active").length,
      internetAccessLicense: {
        skuPartNumber: suite?.skuPartNumber,
        skuCapabilityStatus: suite?.capabilityStatus,
        servicePlanName: suite?.servicePlans?.find((entry) => entry.servicePlanId === INTERNET_ACCESS_PLAN_ID)?.servicePlanName,
        assigned: Boolean(suiteAssignment),
        servicePlanEnabled: Boolean(suiteAssignment) && !suiteAssignment.disabledPlans?.includes(INTERNET_ACCESS_PLAN_ID),
      },
    },
    retainedConditionalAccess: retainedPolicies,
    endpoint,
  };
}

function validateStanding(state, requireAssignment = true) {
  if (state.profile.id !== INTERNET_PROFILE_ID || state.profile.trafficForwardingType !== "internet" || state.profile.state !== "enabled") {
    throw new Error("The built-in Internet forwarding profile is not enabled");
  }
  if (state.profileServicePrincipal.id !== INTERNET_PROFILE_SP_ID || state.profileServicePrincipal.displayName !== INTERNET_PROFILE_SP_NAME || state.profileServicePrincipal.accountEnabled !== true) {
    throw new Error("The Internet forwarding profile service principal changed unexpectedly");
  }
  if (state.rachel.id !== RACHEL_ID || state.rachel.userPrincipalName !== RACHEL_UPN || state.rachel.accountEnabled !== true) {
    throw new Error("Rachel identity changed unexpectedly");
  }
  if (
    state.rachel.internetAccessLicense.skuPartNumber !== "Microsoft_Entra_Suite" ||
    state.rachel.internetAccessLicense.skuCapabilityStatus !== "Enabled" ||
    state.rachel.internetAccessLicense.servicePlanName !== "Entra_Premium_Internet_Access" ||
    state.rachel.internetAccessLicense.assigned !== true ||
    state.rachel.internetAccessLicense.servicePlanEnabled !== true
  ) throw new Error("Rachel's Entra Internet Access license is not active");
  if (requireAssignment && (!state.assignment || state.assignment.appRoleId !== DEFAULT_APP_ROLE_ID)) {
    throw new Error("Rachel is not directly assigned to the Internet forwarding profile");
  }
  if (state.retainedConditionalAccess.length !== 5 || state.retainedConditionalAccess.some((entry) => entry.state !== "enabled")) {
    throw new Error("W73 or a retained YouTrack Conditional Access policy is not intact and enabled");
  }
  if (state.endpoint.assignedUser !== RACHEL_UPN) throw new Error("Rachel is no longer the exact endpoint assignment");
}

async function assign() {
  const before = await standingState();
  validateStanding(before, false);
  if (!before.assignment) {
    await graph(`/v1.0/users/${RACHEL_ID}/appRoleAssignments`, {
      method: "POST",
      body: JSON.stringify({ principalId: RACHEL_ID, resourceId: INTERNET_PROFILE_SP_ID, appRoleId: DEFAULT_APP_ROLE_ID }),
    });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await sleep(2500);
      const current = await standingState();
      if (current.assignment) {
        validateStanding(current);
        console.log(JSON.stringify({ changed: true, state: current }, null, 2));
        return;
      }
    }
    throw new Error("The accepted profile assignment did not become observable");
  }
  validateStanding(before);
  console.log(JSON.stringify({ changed: false, state: before }, null, 2));
}

async function runCommand(script) {
  const initial = await arm(`${vm}/runCommand?api-version=2024-11-01`, {
    method: "POST",
    body: JSON.stringify({ commandId: "RunPowerShellScript", script: [script] }),
  });
  const resultUrl = initial.response.headers.get("location");
  const pollUrl = initial.response.headers.get("azure-asyncoperation") ?? resultUrl;
  if (!pollUrl) throw new Error("ARM Run Command did not provide an operation URL");
  let result;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(3000);
    result = (await arm(pollUrl)).body;
    const status = result?.status ?? result?.properties?.provisioningState;
    if (/succeeded/i.test(String(status))) break;
    if (/failed|canceled/i.test(String(status))) throw new Error(`ARM Run Command ${status}`);
  }
  result = (await arm(resultUrl ?? pollUrl)).body;
  const entries = result?.properties?.output?.value ?? result?.value ?? [];
  const output = entries.find((entry) => /StdOut/i.test(entry.code))?.message?.trim();
  if (!output) throw new Error("ARM Run Command completed without guest output");
  try { return JSON.parse(output); } catch { throw new Error(`Guest output was not JSON: ${output.slice(0, 300)}`); }
}

const guestInventory = String.raw`
$ErrorActionPreference = 'Stop'
$products = @(Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Global Secure Access' } | Select-Object DisplayName,DisplayVersion,InstallLocation)
$services = @(Get-Service | Where-Object { $_.Name -match 'GlobalSecure|GSA' -or $_.DisplayName -match 'Global Secure Access' } | Select-Object Name,DisplayName,@{n='Status';e={$_.Status.ToString()}},@{n='StartType';e={$_.StartType.ToString()}})
[pscustomobject]@{ observedUtc=(Get-Date).ToUniversalTime().ToString('o'); products=$products; services=$services } | ConvertTo-Json -Depth 5 -Compress | Write-Output
`;

async function install() {
  const before = await standingState();
  validateStanding(before);
  if (before.endpoint.power !== "PowerState/running" || before.endpoint.hostStatus !== "Available" || before.endpoint.sessions.length) {
    throw new Error("Install requires Rachel's running, available endpoint with zero sessions");
  }
  let guest = await runCommand(guestInventory);
  let changed = false;
  if (!guest.products?.length) {
    const installer = String.raw`
$ErrorActionPreference = 'Stop'
$stage = Join-Path $env:ProgramData 'AP2\GSAInstall'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$installer = Join-Path $stage 'GlobalSecureAccessClient.exe'
try {
  Invoke-WebRequest -UseBasicParsing -Uri '${INSTALLER_URL}' -OutFile $installer
  $process = Start-Process -FilePath $installer -ArgumentList '/quiet' -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010, 1641)) { throw "Installer exit $($process.ExitCode)" }
} finally {
  Remove-Item $installer -Force -ErrorAction SilentlyContinue
  Remove-Item $stage -Force -ErrorAction SilentlyContinue
}
${guestInventory}
`;
    guest = await runCommand(installer);
    changed = true;
  }
  if (
    !guest.products?.some((entry) => entry.DisplayName === "Global Secure Access Client" && entry.DisplayVersion) ||
    guest.services?.length < 4 ||
    guest.services.some((entry) => entry.StartType !== "Automatic" || entry.Status !== "Running")
  ) {
    throw new Error(`GSA guest state is not healthy: ${JSON.stringify(guest)}`);
  }
  console.log(JSON.stringify({ changed, standing: before, guest }, null, 2));
}

async function traffic() {
  if (!SINCE || Number.isNaN(Date.parse(SINCE))) throw new Error("traffic mode requires an ISO-8601 since timestamp");
  const state = await standingState();
  validateStanding(state);
  const clauses = [`userPrincipalName eq '${RACHEL_UPN}'`, `createdDateTime ge ${SINCE}`];
  if (DESTINATION_FQDN) clauses.push(`destinationFQDN eq '${DESTINATION_FQDN.replaceAll("'", "''")}'`);
  const filter = encodeURIComponent(clauses.join(" and "));
  const { body } = await graph(`/beta/networkAccess/logs/traffic?$filter=${filter}&$orderby=createdDateTime%20desc&$top=100`, {
    headers: { Prefer: "include-unknown-enum-members" },
  });
  const logs = (body.value ?? []).map((entry) => ({
    transactionId: entry.transactionId,
    createdDateTime: entry.createdDateTime,
    userPrincipalName: entry.userPrincipalName,
    userId: entry.userId,
    deviceId: entry.deviceId,
    deviceCategory: entry.deviceCategory,
    deviceOperatingSystem: entry.deviceOperatingSystem,
    agentVersion: entry.agentVersion,
    trafficType: entry.trafficType,
    destinationFQDN: entry.destinationFQDN,
    destinationUrl: entry.destinationUrl,
    destinationPort: entry.destinationPort,
    action: entry.action,
    operationStatus: entry.operationStatus,
    initiatingProcessName: entry.initiatingProcessName,
    httpMethod: entry.httpMethod,
    responseCode: entry.responseCode,
    popProcessingRegion: entry.popProcessingRegion,
    connectionId: entry.connectionId,
  }));
  if (DESTINATION_FQDN && !logs.length) throw new Error(`No Rachel traffic was visible for ${DESTINATION_FQDN}`);
  console.log(JSON.stringify({ observedUtc: new Date().toISOString(), since: SINCE, destinationFQDN: DESTINATION_FQDN, state, logs }, null, 2));
}

async function guest() {
  const state = await standingState();
  validateStanding(state);
  if (state.endpoint.power !== "PowerState/running") throw new Error("Guest observation requires the running endpoint");
  const observation = await runCommand(String.raw`
$ErrorActionPreference = 'Stop'
$services = @(Get-Service | Where-Object { $_.Name -match 'GlobalSecureAccess' } | Select-Object Name,@{n='Status';e={$_.Status.ToString()}},@{n='StartType';e={$_.StartType.ToString()}})
$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'GlobalSecureAccess' } | Select-Object Name,ProcessId,SessionId,ExecutablePath)
$eventLogs = @(Get-WinEvent -ListLog * -ErrorAction SilentlyContinue | Where-Object { $_.LogName -match 'Global.*Secure.*Access|Secure.*Access.*Global' } | Select-Object LogName,RecordCount,IsEnabled)
$events = @()
foreach ($log in $eventLogs) {
  $events += @(Get-WinEvent -LogName $log.LogName -MaxEvents 5 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,LevelDisplayName,ProviderName,@{n='Message';e={([string]$_.Message -replace '[\r\n]+',' ').Substring(0,[Math]::Min(160,([string]$_.Message -replace '[\r\n]+',' ').Length))}})
}
$stageExists = Test-Path (Join-Path $env:ProgramData 'AP2\GSAInstall')
[pscustomobject]@{ observedUtc=(Get-Date).ToUniversalTime().ToString('o'); services=$services; processes=$processes; eventLogs=$eventLogs; events=$events; installerStageExists=$stageExists } | ConvertTo-Json -Depth 6 -Compress | Write-Output
`);
  if (
    observation.services?.length < 4 ||
    observation.services.some((entry) => entry.Status !== "Running" || entry.StartType !== "Automatic") ||
    observation.installerStageExists
  ) throw new Error(`Guest standing health check failed: ${JSON.stringify(observation)}`);
  console.log(JSON.stringify({ state, guest: observation }, null, 2));
}

if (MODE === "inspect") {
  const state = await standingState();
  validateStanding(state);
  console.log(JSON.stringify(state, null, 2));
} else if (MODE === "assign") await assign();
else if (MODE === "install") await install();
else if (MODE === "guest") await guest();
else await traffic();
