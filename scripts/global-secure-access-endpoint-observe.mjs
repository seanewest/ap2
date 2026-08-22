import fs from "node:fs";
import path from "node:path";
import { ClientCertificateCredential } from "@azure/identity";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

const TENANT_ID = "92563293-315c-4b6c-9b90-bcb47ee8c970";
const TARGETS = Object.freeze([
  {
    name: "Kobe",
    resourceGroup: "rg-ap2-avd-fla-kobe",
    vm: "ap2kobefresh-vm",
    hostPool: "ap2flakobe-hp",
    sessionHost: "ap2kobefresh",
  },
  {
    name: "Marge",
    resourceGroup: "rg-ap2-avd-img-marge",
    vm: "ap2margev7-vm",
    hostPool: "ap2imgmarge-hp",
    sessionHost: "ap2margev7",
  },
]);

const runtime = resolveAp2RuntimeRoot();
const config = JSON.parse(fs.readFileSync(path.join(runtime, "secrets/dev-graph/config.json"), "utf8"));
if (config.tenantId !== TENANT_ID) throw new Error("Dev credential is not bound to the Student tenant");
const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
  certificatePath: path.join(runtime, "secrets/dev-graph/credential.pem"),
});
const token = (await credential.getToken("https://management.azure.com/.default"))?.token;
if (!token) throw new Error("ARM token acquisition failed");
const origin = "https://management.azure.com";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function arm(pathname, init = {}) {
  const response = await fetch(pathname.startsWith("http") ? pathname : `${origin}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { text: text.slice(0, 800) }; }
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${pathname} -> ${response.status} ${body?.error?.code ?? "unknown"}`);
  return { response, body };
}

async function runCommand(vm, script) {
  const initial = await arm(`${vm}/runCommand?api-version=2024-11-01`, {
    method: "POST",
    body: JSON.stringify({ commandId: "RunPowerShellScript", script: [script] }),
  });
  const resultUrl = initial.response.headers.get("location");
  const pollUrl = initial.response.headers.get("azure-asyncoperation") ?? resultUrl;
  if (!pollUrl) throw new Error("ARM Run Command did not provide an operation URL");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(3000);
    const result = (await arm(pollUrl)).body;
    const status = result?.status ?? result?.properties?.provisioningState;
    if (/succeeded/i.test(String(status))) break;
    if (/failed|canceled/i.test(String(status))) throw new Error(`ARM Run Command ${status}`);
    if (attempt === 119) throw new Error("ARM Run Command remained ambiguous after the bounded wait");
  }
  const result = (await arm(resultUrl ?? pollUrl)).body;
  const entries = result?.properties?.output?.value ?? result?.value ?? [];
  const output = entries.find((entry) => /StdOut/i.test(entry.code))?.message?.trim();
  if (!output) throw new Error("ARM Run Command completed without guest output");
  try { return JSON.parse(output); } catch { throw new Error(`Guest output was not JSON: ${output.slice(0, 300)}`); }
}

const guestInspection = String.raw`$products = @(Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Global Secure Access*' } | Select-Object DisplayName,DisplayVersion,Publisher)
$services = @(Get-Service -Name 'GlobalSecureAccess*' -ErrorAction SilentlyContinue | ForEach-Object { $service = $_; $cim = Get-CimInstance Win32_Service -Filter "Name='$($service.Name)'"; [ordered]@{Name=$service.Name;Status=[string]$service.Status;StartMode=$cim.StartMode} })
$ime = Get-CimInstance Win32_Service -Filter "Name='IntuneManagementExtension'" -ErrorAction SilentlyContinue
$ipv4Preference = Get-ItemPropertyValue 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters' -Name DisabledComponents -ErrorAction SilentlyContinue
[ordered]@{observedUtc=(Get-Date).ToUniversalTime().ToString('o');computerName=$env:COMPUTERNAME;products=$products;services=$services;intuneManagementExtension=if($ime){[ordered]@{Status=$ime.State;StartMode=$ime.StartMode}}else{$null};disabledComponents=$ipv4Preference} | ConvertTo-Json -Depth 6 -Compress`;

const results = [];
for (const target of TARGETS) {
  const base = `/subscriptions/${config.subscriptionId}/resourceGroups/${target.resourceGroup}/providers`;
  const vm = `${base}/Microsoft.Compute/virtualMachines/${target.vm}`;
  const host = `${base}/Microsoft.DesktopVirtualization/hostPools/${target.hostPool}/sessionHosts/${target.sessionHost}`;
  const [view, sessionHost, sessions] = await Promise.all([
    arm(`${vm}/instanceView?api-version=2024-11-01`).then(({ body }) => body),
    arm(`${host}?api-version=2024-04-03`).then(({ body }) => body),
    arm(`${host}/userSessions?api-version=2024-04-03`).then(({ body }) => body.value ?? []),
  ]);
  const power = view.statuses?.find((entry) => entry.code?.startsWith("PowerState/"))?.code;
  if (power !== "PowerState/running" || sessions.length !== 0) {
    throw new Error(`${target.name} is not running with zero sessions; refusing guest observation`);
  }
  const guest = await runCommand(vm, guestInspection);
  if (!guest.products?.some((entry) => entry.DisplayVersion === "2.31.125") ||
      guest.services?.length !== 4 || guest.services.some((entry) => entry.Status !== "Running" || entry.StartMode !== "Auto") ||
      guest.disabledComponents !== 32) {
    throw new Error(`${target.name} does not have the supported GSA 2.31.125 client and four running automatic services`);
  }
  results.push({ target: target.name, vm: target.vm, power, hostStatus: sessionHost.properties?.status, sessions: [], guest });
}

console.log(JSON.stringify({ observedUtc: new Date().toISOString(), results, powerChanged: false }, null, 2));
