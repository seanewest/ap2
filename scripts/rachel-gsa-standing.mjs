import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
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
const INTERNET_RESOURCE_APP_ID = "5dc48733-b5df-475c-a49b-fa307ef00853";
const TLS_CA_NAME = "AP2RachelCA";
const TLS_CA_COMMON_NAME = "AP2 Student GSA TLS Root CA";
const TLS_CA_ORGANIZATION = "After Party Exploratory";
const TLS_POLICY_NAME = "AP2 Rachel narrow TLS inspection";
const TLS_RULE_NAME = "Inspect AP2 company access host";
const FILTERING_PROFILE_NAME = "AP2 Rachel TLS inspection profile";
const FILTERING_PROFILE_PRIORITY = 100;
const INSPECTION_CA_POLICY_NAME = "AP2 Rachel TLS inspection assignment";
const INSPECTION_FQDN = "seanewest.github.io";
const MODE = process.argv[2];
const SINCE = process.argv[3];
const DESTINATION_FQDN = process.argv[4];

if (!new Set(["inspect", "inspection", "tls-reconcile", "assign", "install", "guest", "traffic"]).has(MODE)) {
  throw new Error("mode must be inspect, inspection, tls-reconcile, assign, install, guest, or traffic");
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
    throw new Error(`${init.method ?? "GET"} ${pathname} -> ${response.status} ${body?.error?.code ?? "unknown"}: ${body?.error?.message ?? "no message"}`);
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
    filteringProfileId: entry.filteringProfileId,
    filteringProfileName: entry.filteringProfileName,
    policyId: entry.policyId,
    policyName: entry.policyName,
    policyRuleId: entry.policyRuleId,
    policyRuleName: entry.policyRuleName,
    action: entry.action,
    operationStatus: entry.operationStatus,
    initiatingProcessName: entry.initiatingProcessName,
    httpMethod: entry.httpMethod,
    responseCode: entry.responseCode,
    tlsDetails: entry.tlsDetails,
    popProcessingRegion: entry.popProcessingRegion,
    connectionId: entry.connectionId,
  }));
  if (DESTINATION_FQDN && !logs.length) throw new Error(`No Rachel traffic was visible for ${DESTINATION_FQDN}`);
  console.log(JSON.stringify({ observedUtc: new Date().toISOString(), since: SINCE, destinationFQDN: DESTINATION_FQDN, state, logs }, null, 2));
}

async function inspectionState() {
  const [certificates, policies, profiles, conditionalAccess] = await Promise.all([
    graph("/beta/networkAccess/tls/externalCertificateAuthorityCertificates", { headers: { Prefer: "include-unknown-enum-members" } }),
    graph("/beta/networkAccess/tlsInspectionPolicies?$expand=policyRules"),
    graph("/beta/networkAccess/filteringProfiles?$expand=policies($expand=policy)"),
    graph("/beta/identity/conditionalAccess/policies?$select=id,displayName,state,conditions,sessionControls"),
  ]);
  return {
    observedUtc: new Date().toISOString(),
    certificates: (certificates.body.value ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      commonName: entry.commonName,
      organizationName: entry.organizationName,
      status: entry.status,
      validity: entry.validity,
      hasCertificate: Boolean(entry.certificate),
      hasChain: Boolean(entry.chain),
      hasCertificateSigningRequest: Boolean(entry.certificateSigningRequest),
    })),
    policies: policies.body.value ?? [],
    profiles: profiles.body.value ?? [],
    conditionalAccess: (conditionalAccess.body.value ?? []).filter((entry) =>
      entry.sessionControls?.globalSecureAccessFilteringProfile ||
      entry.conditions?.users?.includeUsers?.includes(RACHEL_ID)
    ),
  };
}

function requireSingleExact(items, name, label) {
  const exact = items.filter((entry) => entry.name === name || entry.displayName === name);
  if (exact.length > 1) throw new Error(`More than one ${label} has the exact retained name`);
  return exact[0];
}

function ensureRootCertificate() {
  const directory = path.join(runtime, "secrets/gsa-rachel-tls");
  const keyPath = path.join(directory, "root-ca.key");
  const certificatePath = path.join(directory, "root-ca.pem");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const keyExists = fs.existsSync(keyPath);
  const certificateExists = fs.existsSync(certificatePath);
  if (keyExists !== certificateExists) throw new Error("Protected TLS root material is incomplete; refusing replacement");
  let changed = false;
  if (!keyExists) {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:4096", "-sha256", "-days", "3650", "-nodes",
      "-keyout", keyPath, "-out", certificatePath,
      "-subj", `/CN=${TLS_CA_COMMON_NAME}/O=${TLS_CA_ORGANIZATION}`,
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign",
      "-addext", "subjectKeyIdentifier=hash",
    ], { stdio: "ignore" });
    changed = true;
  }
  fs.chmodSync(keyPath, 0o600);
  fs.chmodSync(certificatePath, 0o600);
  const certificate = fs.readFileSync(certificatePath, "utf8");
  const x509 = new X509Certificate(certificate);
  if (!x509.ca || !x509.subject.includes(`CN=${TLS_CA_COMMON_NAME}`)) throw new Error("Protected TLS root certificate contract changed");
  return {
    directory,
    keyPath,
    certificatePath,
    certificate,
    thumbprint: x509.fingerprint.replaceAll(":", "").toUpperCase(),
    changed,
  };
}

async function reconcileCertificateAuthority() {
  const root = ensureRootCertificate();
  const certificateSelect = "$select=id,name,commonName,organizationName,status,validity,certificateSigningRequest,certificate,chain";
  const enumHeaders = { headers: { Prefer: "include-unknown-enum-members" } };
  const csrPath = path.join(root.directory, "gsa-issuer.csr.pem");
  let collection = (await graph("/beta/networkAccess/tls/externalCertificateAuthorityCertificates")).body.value ?? [];
  let authority = requireSingleExact(collection, TLS_CA_NAME, "TLS certificate authority");
  let created = false;
  if (!authority) {
    authority = (await graph("/beta/networkAccess/tls/externalCertificateAuthorityCertificates", {
      method: "POST",
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.networkaccess.externalCertificateAuthorityCertificate",
        name: TLS_CA_NAME,
        commonName: TLS_CA_COMMON_NAME,
        organizationName: TLS_CA_ORGANIZATION,
      }),
    })).body;
    created = true;
  }
  authority = (await graph(`/beta/networkAccess/tls/externalCertificateAuthorityCertificates/${authority.id}?${certificateSelect}`, enumHeaders)).body;
  if (authority.name !== TLS_CA_NAME || authority.commonName !== TLS_CA_COMMON_NAME || authority.organizationName !== TLS_CA_ORGANIZATION) {
    throw new Error("The retained TLS certificate authority identity changed");
  }
  let recreatedForCsr = false;
  if (authority.status === "csrGenerated" && !authority.certificateSigningRequest && !fs.existsSync(csrPath)) {
    if (authority.certificate || authority.chain) throw new Error("TLS certificate authority has certificate material but no retrievable CSR");
    await graph(`/beta/networkAccess/tls/externalCertificateAuthorityCertificates/${authority.id}`, { method: "DELETE" });
    await graph(`/beta/networkAccess/tls/externalCertificateAuthorityCertificates/${authority.id}`, {}, [404]);
    authority = (await graph("/beta/networkAccess/tls/externalCertificateAuthorityCertificates", {
      method: "POST",
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.networkaccess.externalCertificateAuthorityCertificate",
        name: TLS_CA_NAME,
        commonName: TLS_CA_COMMON_NAME,
        organizationName: TLS_CA_ORGANIZATION,
      }),
    })).body;
    recreatedForCsr = true;
    if (authority.certificateSigningRequest) fs.writeFileSync(csrPath, authority.certificateSigningRequest, { mode: 0o600 });
  }
  let uploaded = false;
  if (authority.status === "csrGenerated") {
    const csr = authority.certificateSigningRequest ?? (fs.existsSync(csrPath) ? fs.readFileSync(csrPath, "utf8") : null);
    if (!csr) throw new Error(`TLS certificate authority is ${authority.status} without a retrievable CSR after one supported recreate`);
    const issuerPath = path.join(root.directory, "gsa-issuer.pem");
    const serialPath = path.join(root.directory, "root-ca.srl");
    fs.writeFileSync(csrPath, csr, { mode: 0o600 });
    const args = [
      "x509", "-req", "-in", csrPath, "-CA", root.certificatePath, "-CAkey", root.keyPath,
      "-out", issuerPath, "-days", "365", "-sha256", "-copy_extensions", "copyall",
    ];
    if (fs.existsSync(serialPath)) args.push("-CAserial", serialPath);
    else args.push("-CAcreateserial");
    execFileSync("openssl", args, { stdio: "ignore" });
    fs.rmSync(path.join(root.directory, "gsa-issuer.ext"), { force: true });
    for (const protectedPath of [csrPath, issuerPath, serialPath]) {
      if (fs.existsSync(protectedPath)) fs.chmodSync(protectedPath, 0o600);
    }
    const issuer = fs.readFileSync(issuerPath, "utf8");
    const issuerCertificate = new X509Certificate(issuer);
    if (!issuerCertificate.ca || !issuerCertificate.checkIssued(new X509Certificate(root.certificate))) {
      throw new Error("Generated GSA issuer certificate does not chain to the retained TLS root");
    }
    await graph(`/beta/networkAccess/tls/externalCertificateAuthorityCertificates/${authority.id}`, {
      method: "PATCH",
      body: JSON.stringify({ certificate: issuer, chain: root.certificate }),
    });
    uploaded = true;
  }
  let enabled = false;
  if (authority.status === "disabled") {
    await graph(`/beta/networkAccess/tls/externalCertificateAuthorityCertificates/${authority.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "enabled" }),
    });
    enabled = true;
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    authority = (await graph(`/beta/networkAccess/tls/externalCertificateAuthorityCertificates/${authority.id}?${certificateSelect}`, enumHeaders)).body;
    if (new Set(["active", "enabled", "expiring"]).has(authority.status)) break;
    if (new Set(["expired", "disabled", "revoked"]).has(authority.status)) throw new Error(`TLS certificate authority reached ${authority.status}`);
    if (attempt < 59) await sleep(5000);
  }
  if (!new Set(["active", "enabled", "expiring"]).has(authority.status)) {
    throw new Error(`TLS certificate authority remained ${authority.status} after upload`);
  }
  return { root, authority, created, recreatedForCsr, uploaded, enabled };
}

async function installRootTrust(root) {
  const encoded = Buffer.from(root.certificate, "utf8").toString("base64");
  const result = await runCommand(String.raw`
$ErrorActionPreference = 'Stop'
$thumbprint = '${root.thumbprint}'
$existing = Get-ChildItem Cert:\LocalMachine\Root | Where-Object Thumbprint -eq $thumbprint
$changed = $false
if (!$existing) {
  $stage = Join-Path $env:ProgramData 'AP2\GSATrust'
  $certificate = Join-Path $stage 'root-ca.pem'
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  try {
    [IO.File]::WriteAllBytes($certificate, [Convert]::FromBase64String('${encoded}'))
    & certutil.exe -f -addstore Root $certificate | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "certutil failed with $LASTEXITCODE" }
    $changed = $true
  } finally {
    Remove-Item $certificate -Force -ErrorAction SilentlyContinue
    Remove-Item $stage -Force -ErrorAction SilentlyContinue
  }
}
$current = @(Get-ChildItem Cert:\LocalMachine\Root | Where-Object Thumbprint -eq $thumbprint)
[pscustomobject]@{
  observedUtc=(Get-Date).ToUniversalTime().ToString('o')
  changed=$changed
  trustedCount=$current.Count
  subject=$current[0].Subject
  notAfter=$current[0].NotAfter.ToUniversalTime().ToString('o')
  stageAbsent=(-not (Test-Path (Join-Path $env:ProgramData 'AP2\GSATrust')))
} | ConvertTo-Json -Compress | Write-Output
`);
  if (result.trustedCount !== 1 || !result.stageAbsent || !String(result.subject).includes(TLS_CA_COMMON_NAME)) {
    throw new Error(`Rachel endpoint TLS root trust is unhealthy: ${JSON.stringify(result)}`);
  }
  return result;
}

async function reconcileTlsPolicy() {
  let policies = (await graph("/beta/networkAccess/tlsInspectionPolicies?$expand=policyRules")).body.value ?? [];
  let policy = requireSingleExact(policies, TLS_POLICY_NAME, "TLS inspection policy");
  let policyCreated = false;
  if (!policy) {
    policy = (await graph("/beta/networkAccess/tlsInspectionPolicies", {
      method: "POST",
      body: JSON.stringify({
        name: TLS_POLICY_NAME,
        description: "Inspect only AP2's existing benign company-access host; bypass all other TLS traffic.",
        settings: { defaultAction: "bypass" },
      }),
    })).body;
    policyCreated = true;
  }
  policy = (await graph(`/beta/networkAccess/tlsInspectionPolicies/${policy.id}?$expand=policyRules`)).body;
  if (policy.settings?.defaultAction !== "bypass") throw new Error("Retained TLS policy no longer defaults to bypass");
  const exactRules = (policy.policyRules ?? []).filter((entry) => entry.name === TLS_RULE_NAME);
  if (exactRules.length > 1) throw new Error("More than one exact TLS inspection rule exists");
  let rule = exactRules[0];
  let ruleCreated = false;
  if (!rule) {
    rule = (await graph(`/beta/networkAccess/tlsInspectionPolicies/${policy.id}/policyRules`, {
      method: "POST",
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.networkaccess.tlsInspectionRule",
        name: TLS_RULE_NAME,
        description: "Inspect only AP2's existing harmless public proof host.",
        action: "inspect",
        priority: 100,
        settings: { status: "enabled" },
        matchingConditions: {
          destinations: [{
            "@odata.type": "#microsoft.graph.networkaccess.tlsInspectionFqdnDestination",
            values: [INSPECTION_FQDN],
          }],
        },
      }),
    })).body;
    ruleCreated = true;
  }
  const destination = rule.matchingConditions?.destinations?.find((entry) => entry["@odata.type"]?.endsWith("tlsInspectionFqdnDestination"));
  if (rule.action !== "inspect" || rule.settings?.status !== "enabled" || rule.priority !== 100 || JSON.stringify(destination?.values) !== JSON.stringify([INSPECTION_FQDN])) {
    throw new Error("Retained TLS inspection rule is not the exact narrow enabled rule");
  }
  const systemBypass = (policy.policyRules ?? []).filter((entry) => entry.name === "System Bypass TLS inspection rule");
  const recommendedBypass = (policy.policyRules ?? []).filter((entry) => entry.name === "Recommended TLS inspection bypass categories rule");
  const recommendedCategories = new Set(recommendedBypass[0]?.matchingConditions?.destinations?.flatMap((entry) => entry.values ?? []) ?? []);
  if (
    systemBypass.length !== 1 || systemBypass[0].action !== "bypass" || systemBypass[0].settings?.status !== "enabled" ||
    recommendedBypass.length !== 1 || recommendedBypass[0].action !== "bypass" || recommendedBypass[0].settings?.status !== "enabled" ||
    !["Education", "Finance", "Government", "HealthAndMedicine"].every((category) => recommendedCategories.has(category))
  ) throw new Error("Microsoft's system or recommended TLS bypass behavior is not intact and enabled");
  return { policy, rule, policyCreated, ruleCreated };
}

async function reconcileFilteringProfile(policy) {
  let profiles = (await graph("/beta/networkAccess/filteringProfiles?$expand=policies($expand=policy)")).body.value ?? [];
  let profile = requireSingleExact(profiles, FILTERING_PROFILE_NAME, "filtering profile");
  let profileCreated = false;
  if (!profile) {
    profile = (await graph("/beta/networkAccess/filteringProfiles", {
      method: "POST",
      body: JSON.stringify({ name: FILTERING_PROFILE_NAME, description: "Rachel-only narrow TLS inspection for AP2's proof host.", state: "enabled", priority: FILTERING_PROFILE_PRIORITY, policies: [] }),
    })).body;
    profileCreated = true;
  }
  if (profile.state !== "enabled" || profile.priority !== FILTERING_PROFILE_PRIORITY) throw new Error("Retained filtering profile is not enabled at the intended priority");
  profile = (await graph(`/beta/networkAccess/filteringProfiles/${profile.id}?$expand=policies($expand=policy)`)).body;
  let links = (profile.policies ?? []).filter((entry) => entry.policy?.id === policy.id);
  if (links.length > 1) throw new Error("TLS inspection policy is linked more than once");
  let linkCreated = false;
  if (!links.length) {
    await graph(`/beta/networkAccess/filteringProfiles/${profile.id}/policies`, {
      method: "POST",
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.networkaccess.tlsInspectionPolicyLink",
        state: "enabled",
        policy: { "@odata.type": "#microsoft.graph.networkaccess.tlsInspectionPolicy", id: policy.id },
      }),
    });
    linkCreated = true;
    profile = (await graph(`/beta/networkAccess/filteringProfiles/${profile.id}?$expand=policies($expand=policy)`)).body;
    links = (profile.policies ?? []).filter((entry) => entry.policy?.id === policy.id);
  }
  if (links.length !== 1 || links[0].state !== "enabled" || (profile.policies ?? []).length !== 1) {
    throw new Error("Retained filtering profile does not contain exactly one enabled TLS policy link");
  }
  return { profile, link: links[0], profileCreated, linkCreated };
}

async function reconcileTlsAssignment(profile) {
  let policies = (await graph("/beta/identity/conditionalAccess/policies?$select=id,displayName,state,conditions,sessionControls")).body.value ?? [];
  let assignment = requireSingleExact(policies, INSPECTION_CA_POLICY_NAME, "TLS inspection Conditional Access policy");
  let created = false;
  if (!assignment) {
    assignment = (await graph("/beta/identity/conditionalAccess/policies", {
      method: "POST",
      body: JSON.stringify({
        displayName: INSPECTION_CA_POLICY_NAME,
        state: "enabled",
        conditions: {
          applications: { includeApplications: [INTERNET_RESOURCE_APP_ID] },
          users: { includeUsers: [RACHEL_ID] },
        },
        sessionControls: {
          globalSecureAccessFilteringProfile: { profileId: profile.id, isEnabled: true },
        },
      }),
    })).body;
    created = true;
  }
  let observedAssignment;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await graph(`/beta/identity/conditionalAccess/policies/${assignment.id}`, {}, [404]);
    if (current.response.ok) { observedAssignment = current.body; break; }
    if (attempt < 11) await sleep(2500);
  }
  if (!observedAssignment) throw new Error("The accepted TLS inspection assignment did not become observable");
  assignment = observedAssignment;
  if (
    assignment.state !== "enabled" ||
    JSON.stringify(assignment.conditions?.applications?.includeApplications) !== JSON.stringify([INTERNET_RESOURCE_APP_ID]) ||
    JSON.stringify(assignment.conditions?.users?.includeUsers) !== JSON.stringify([RACHEL_ID]) ||
    assignment.conditions?.users?.excludeUsers?.length || assignment.conditions?.users?.includeGroups?.length ||
    assignment.sessionControls?.globalSecureAccessFilteringProfile?.profileId !== profile.id ||
    assignment.sessionControls?.globalSecureAccessFilteringProfile?.isEnabled !== true
  ) throw new Error("TLS inspection assignment is not the exact Rachel-only Internet-resource session control");
  return { assignment, created };
}

async function tlsReconcile() {
  const before = await standingState();
  validateStanding(before);
  if (before.endpoint.power !== "PowerState/running" || before.endpoint.hostStatus !== "Available" || before.endpoint.sessions.length) {
    throw new Error("TLS reconciliation requires Rachel's running, available endpoint with zero sessions");
  }
  const certificate = await reconcileCertificateAuthority();
  const trust = await installRootTrust(certificate.root);
  const tls = await reconcileTlsPolicy();
  const filtering = await reconcileFilteringProfile(tls.policy);
  const assignment = await reconcileTlsAssignment(filtering.profile);
  const after = await standingState();
  validateStanding(after);
  const inspection = await inspectionState();
  console.log(JSON.stringify({
    observedUtc: new Date().toISOString(),
    changed: {
      root: certificate.root.changed,
      certificateAuthority: certificate.created,
      certificateAuthorityRecreatedForCsr: certificate.recreatedForCsr,
      certificateUpload: certificate.uploaded,
      certificateEnabled: certificate.enabled,
      endpointTrust: trust.changed,
      tlsPolicy: tls.policyCreated,
      tlsRule: tls.ruleCreated,
      filteringProfile: filtering.profileCreated,
      policyLink: filtering.linkCreated,
      conditionalAccessAssignment: assignment.created,
    },
    certificateAuthority: {
      id: certificate.authority.id,
      name: certificate.authority.name,
      commonName: certificate.authority.commonName,
      organizationName: certificate.authority.organizationName,
      status: certificate.authority.status,
      validity: certificate.authority.validity,
    },
    endpointTrust: trust,
    tlsPolicy: { id: tls.policy.id, name: tls.policy.name, settings: tls.policy.settings, rule: tls.rule },
    filteringProfile: filtering.profile,
    assignment: assignment.assignment,
    standing: after,
    inspection,
  }, null, 2));
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
} else if (MODE === "inspection") console.log(JSON.stringify(await inspectionState(), null, 2));
else if (MODE === "tls-reconcile") await tlsReconcile();
else if (MODE === "assign") await assign();
else if (MODE === "install") await install();
else if (MODE === "guest") await guest();
else await traffic();
