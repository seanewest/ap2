import fs from "node:fs";
import path from "node:path";
import { ClientCertificateCredential } from "@azure/identity";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

export const STUDENT_TENANT_ID = "92563293-315c-4b6c-9b90-bcb47ee8c970";
export const TCM_APP_ID = "03b07b79-c5bc-4b5e-9bfa-13acf4a99998";
export const M365_ADMIN_SERVICES_APP_ID = "6b91db1b-f05b-405a-a0b2-e3f60b28d645";
export const GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";
export const MONITOR_NAME = "AP2 Student W73 Conditional Access baseline";
export const APPLY_CONFIRMATION = "PATCH-EXISTING-W73-POLICIES";

const TCM_READ_PERMISSIONS = Object.freeze([
  "Agreement.Read.All",
  "Application.Read.All",
  "CustomSecAttributeDefinition.Read.All",
  "Group.Read.All",
  "Policy.Read.All",
  "RoleManagement.Read.Directory",
  "User.Read.All",
]);

function fail(message) {
  throw new Error(message);
}

function arrays(value) {
  return Array.isArray(value) ? value : [];
}

export function validateDesiredState(input) {
  if (input?.displayName !== MONITOR_NAME || !Array.isArray(input.resources)) {
    fail("Desired state has an unexpected monitor identity");
  }
  if (input.resources.length !== 3) fail("Desired state must contain exactly the three W73 policies");
  const ids = new Set();
  const names = new Set();
  for (const resource of input.resources) {
    if (resource.resourceType !== "microsoft.entra.conditionalaccesspolicy") {
      fail("Only Conditional Access is allowed in the initial desired-state set");
    }
    const properties = resource.properties;
    if (!properties?.Id || properties.DisplayName !== resource.displayName || properties.Ensure !== "Present") {
      fail("Each desired resource requires one exact existing ID and matching display name");
    }
    if (ids.has(properties.Id) || names.has(properties.DisplayName)) fail("Desired resource identities must be unique");
    ids.add(properties.Id);
    names.add(properties.DisplayName);
  }
  return input;
}

export function comparablePolicy(policy) {
  return {
    DisplayName: policy.displayName,
    Id: policy.id,
    State: policy.state,
    IncludeApplications: arrays(policy.conditions?.applications?.includeApplications),
    ExcludeApplications: arrays(policy.conditions?.applications?.excludeApplications),
    IncludeUserActions: arrays(policy.conditions?.applications?.includeUserActions),
    AuthenticationContexts: arrays(policy.conditions?.applications?.includeAuthenticationContextClassReferences),
    IncludeUsers: arrays(policy.conditions?.users?.includeUsers),
    ExcludeUsers: arrays(policy.conditions?.users?.excludeUsers),
    IncludeGroups: arrays(policy.conditions?.users?.includeGroups),
    ExcludeGroups: arrays(policy.conditions?.users?.excludeGroups),
    IncludeRoles: arrays(policy.conditions?.users?.includeRoles),
    ExcludeRoles: arrays(policy.conditions?.users?.excludeRoles),
    ClientAppTypes: arrays(policy.conditions?.clientAppTypes),
    GrantControlOperator: policy.grantControls?.operator,
    BuiltInControls: arrays(policy.grantControls?.builtInControls),
    ...(policy.conditions?.authenticationFlows?.transferMethods
      ? { TransferMethods: policy.conditions.authenticationFlows.transferMethods }
      : {}),
    Ensure: "Present",
  };
}

export function graphPatch(properties) {
  return {
    displayName: properties.DisplayName,
    state: properties.State,
    conditions: {
      users: {
        includeUsers: properties.IncludeUsers,
        excludeUsers: properties.ExcludeUsers,
        includeGroups: properties.IncludeGroups,
        excludeGroups: properties.ExcludeGroups,
        includeRoles: properties.IncludeRoles,
        excludeRoles: properties.ExcludeRoles,
      },
      applications: {
        includeApplications: properties.IncludeApplications,
        excludeApplications: properties.ExcludeApplications,
        includeUserActions: properties.IncludeUserActions,
        includeAuthenticationContextClassReferences: properties.AuthenticationContexts,
      },
      clientAppTypes: properties.ClientAppTypes,
      ...(properties.TransferMethods
        ? { authenticationFlows: { transferMethods: properties.TransferMethods } }
        : {}),
    },
    grantControls: {
      operator: properties.GrantControlOperator,
      builtInControls: properties.BuiltInControls,
    },
  };
}

function hasUnmodeledControls(policy) {
  const values = [
    policy.conditions?.userRiskLevels,
    policy.conditions?.signInRiskLevels,
    policy.conditions?.platforms,
    policy.conditions?.locations,
    policy.conditions?.devices,
    policy.conditions?.clientApplications,
    policy.sessionControls,
  ];
  return values.some((value) => value && (!Array.isArray(value) || value.length > 0));
}

export function comparePolicies(desired, livePolicies) {
  const desiredIds = new Set(desired.resources.map((resource) => resource.properties.Id));
  const desiredNames = new Set(desired.resources.map((resource) => resource.properties.DisplayName));
  const relevant = livePolicies.filter((policy) => desiredIds.has(policy.id) || desiredNames.has(policy.displayName));
  const duplicateNames = [...desiredNames].filter(
    (name) => relevant.filter((policy) => policy.displayName === name).length !== 1,
  );
  const identityConflicts = relevant.filter(
    (policy) => desiredNames.has(policy.displayName) && !desiredIds.has(policy.id),
  );
  if (duplicateNames.length || identityConflicts.length) {
    fail("Live Conditional Access identity is ambiguous; refusing comparison or mutation");
  }
  const results = desired.resources.map((resource) => {
    const live = relevant.find((policy) => policy.id === resource.properties.Id);
    if (!live || live.displayName !== resource.properties.DisplayName) {
      return { id: resource.properties.Id, displayName: resource.displayName, status: "missing-or-renamed" };
    }
    const actual = comparablePolicy(live);
    const expected = resource.properties;
    const changedProperties = Object.keys(expected).filter(
      (key) => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]),
    );
    return {
      id: expected.Id,
      displayName: expected.DisplayName,
      status: changedProperties.length ? "drifted" : "matched",
      changedProperties,
      unmodeledControlsPresent: hasUnmodeledControls(live),
    };
  });
  return results;
}

function loadDesiredState() {
  const file = new URL("../infra/student-tenant-desired-state/conditional-access.json", import.meta.url);
  return validateDesiredState(JSON.parse(fs.readFileSync(file, "utf8")));
}

async function credentialAndConfig() {
  const runtime = resolveAp2RuntimeRoot();
  const config = JSON.parse(fs.readFileSync(path.join(runtime, "secrets/dev-graph/config.json"), "utf8"));
  if (config.tenantId !== STUDENT_TENANT_ID) fail("Dev credential is not bound to the development Student tenant");
  const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
    certificatePath: path.join(runtime, "secrets/dev-graph/credential.pem"),
  });
  return { credential, config, runtime };
}

async function client(credential) {
  let access = await credential.getToken("https://graph.microsoft.com/.default");
  if (!access?.token) fail("Graph token acquisition failed");
  const request = async (pathname, init = {}) => {
    const response = await fetch(`https://graph.microsoft.com${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${access.token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      fail(`${init.method ?? "GET"} ${pathname} -> ${response.status} ${body?.error?.code ?? "unknown"}`);
    }
    return body;
  };
  request.refresh = async () => {
    access = await credential.getToken("https://graph.microsoft.com/.default", { refresh: true });
  };
  return request;
}

async function servicePrincipalByAppId(graph, appId) {
  const filter = encodeURIComponent(`appId eq '${appId}'`);
  const response = await graph(`/v1.0/servicePrincipals?$filter=${filter}&$select=id,appId,displayName,appRoles`);
  if (response.value.length > 1) fail(`Multiple service principals exist for ${appId}`);
  return response.value[0];
}

async function ensureServicePrincipal(graph, appId) {
  const existing = await servicePrincipalByAppId(graph, appId);
  return existing ?? graph("/v1.0/servicePrincipals", {
    method: "POST",
    body: JSON.stringify({ appId }),
  });
}

async function ensureAppRole(graph, principal, resource, permission) {
  const role = resource.appRoles.find(
    (candidate) => candidate.value === permission && candidate.allowedMemberTypes?.includes("Application"),
  );
  if (!role) fail(`${permission} is unavailable on Microsoft Graph`);
  // The alternate-key route remains consistent immediately after provisioning,
  // while the object-ID navigation can briefly return 404 for a new TCM SP.
  const assignmentsPath = `/v1.0/servicePrincipals(appId='${principal.appId}')/appRoleAssignments`;
  const current = await graph(assignmentsPath);
  const exists = current.value.some(
    (assignment) => assignment.resourceId === resource.id && assignment.appRoleId === role.id,
  );
  if (!exists) {
    await graph(assignmentsPath, {
      method: "POST",
      body: JSON.stringify({ principalId: principal.id, resourceId: resource.id, appRoleId: role.id }),
    });
  }
}

async function ensureSecurityReader(graph, principal) {
  const filter = encodeURIComponent("displayName eq 'Security Reader'");
  const definitions = await graph(`/v1.0/roleManagement/directory/roleDefinitions?$filter=${filter}`);
  if (definitions.value.length !== 1) fail("Expected one Security Reader role definition");
  const assignments = await graph(
    `/v1.0/roleManagement/directory/roleAssignments?$filter=${encodeURIComponent(`principalId eq '${principal.id}'`)}`,
  );
  if (!assignments.value.some((assignment) => assignment.roleDefinitionId === definitions.value[0].id)) {
    await graph("/v1.0/roleManagement/directory/roleAssignments", {
      method: "POST",
      body: JSON.stringify({
        principalId: principal.id,
        roleDefinitionId: definitions.value[0].id,
        directoryScopeId: "/",
      }),
    });
  }
}

async function bootstrap(graph, config) {
  const graphSp = await servicePrincipalByAppId(graph, GRAPH_APP_ID);
  const devSp = await servicePrincipalByAppId(graph, config.clientId);
  if (!graphSp || !devSp) fail("Microsoft Graph or Dev diagnostic service principal is absent");
  const m365Admin = await servicePrincipalByAppId(graph, M365_ADMIN_SERVICES_APP_ID);
  if (!m365Admin) fail("M365 Admin Services service principal is absent");
  const tcm = await ensureServicePrincipal(graph, TCM_APP_ID);
  await ensureAppRole(graph, devSp, graphSp, "ConfigurationMonitoring.ReadWrite.All");
  for (const permission of TCM_READ_PERMISSIONS) await ensureAppRole(graph, tcm, graphSp, permission);
  await ensureSecurityReader(graph, tcm);
  return { tcmServicePrincipalId: tcm.id, m365AdminServicesId: m365Admin.id };
}

async function livePolicies(graph) {
  return (await graph("/v1.0/identity/conditionalAccess/policies")).value;
}

async function exactMonitor(graph) {
  const monitors = await graph("/v1.0/admin/configurationManagement/configurationMonitors?$expand=baseline");
  const matches = monitors.value.filter((monitor) => monitor.displayName === MONITOR_NAME);
  if (matches.length > 1) fail("Multiple AP2 W73 monitors exist");
  return matches[0];
}

function monitorBody(desired) {
  return {
    displayName: desired.displayName,
    description: desired.description,
    baseline: desired,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function sameBaseline(monitor, desired) {
  return JSON.stringify(canonicalJson(monitor?.baseline?.resources)) ===
    JSON.stringify(canonicalJson(desired.resources));
}

function writeProtectedResult(runtime, result) {
  const directory = path.join(runtime, "desired-state");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "student-tenant-tcm.json");
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return file;
}

async function main() {
  const mode = process.argv[2];
  if (!new Set(["bootstrap", "ensure-monitor", "inspect", "apply"]).has(mode)) {
    fail("mode must be bootstrap, ensure-monitor, inspect, or apply");
  }
  const desired = loadDesiredState();
  const { credential, config, runtime } = await credentialAndConfig();
  const graph = await client(credential);

  if (mode === "bootstrap") {
    const result = await bootstrap(graph, config);
    const file = writeProtectedResult(runtime, { observedUtc: new Date().toISOString(), mode, ...result });
    console.log(`PASS bootstrap reconciled; protected result: ${file}`);
    return;
  }

  const comparison = comparePolicies(desired, await livePolicies(graph));
  if (comparison.some((entry) => entry.status === "missing-or-renamed")) {
    fail("One or more exact W73 policy identities are absent; this path never creates policies");
  }

  if (mode === "ensure-monitor") {
    if (comparison.some((entry) => entry.status !== "matched")) {
      fail("Live W73 policies must match before a monitor is installed");
    }
    let monitor = await exactMonitor(graph);
    if (!monitor) {
      monitor = await graph("/v1.0/admin/configurationManagement/configurationMonitors", {
        method: "POST",
        body: JSON.stringify(monitorBody(desired)),
      });
    } else if (!sameBaseline(monitor, desired)) {
      fail("Existing AP2 W73 monitor baseline differs; refusing automatic replacement");
    }
    const file = writeProtectedResult(runtime, {
      observedUtc: new Date().toISOString(),
      mode,
      monitor: { id: monitor.id, displayName: monitor.displayName, status: monitor.status },
      comparison,
    });
    console.log(`PASS monitor=${monitor.id} policies=3 matched=3; protected result: ${file}`);
    return;
  }

  const monitor = await exactMonitor(graph);
  if (!monitor || !sameBaseline(monitor, desired)) fail("Exact AP2 W73 TCM monitor is absent or changed");

  if (mode === "apply") {
    if (process.env.AP2_DESIRED_STATE_APPLY !== APPLY_CONFIRMATION) {
      fail(`AP2_DESIRED_STATE_APPLY must equal ${APPLY_CONFIRMATION}`);
    }
    for (const entry of comparison.filter((item) => item.status === "drifted")) {
      if (entry.unmodeledControlsPresent) {
        fail(`Unmodeled controls are present on ${entry.displayName}; refusing to overwrite them`);
      }
      const resource = desired.resources.find((item) => item.properties.Id === entry.id);
      await graph(`/v1.0/identity/conditionalAccess/policies/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify(graphPatch(resource.properties)),
      });
    }
    const after = comparePolicies(desired, await livePolicies(graph));
    if (after.some((entry) => entry.status !== "matched")) fail("W73 drift remains after bounded apply");
    comparison.splice(0, comparison.length, ...after);
  }

  const result = {
    observedUtc: new Date().toISOString(),
    mode,
    monitor: { id: monitor.id, displayName: monitor.displayName, status: monitor.status },
    comparison,
  };
  const file = writeProtectedResult(runtime, result);
  const matched = comparison.filter((entry) => entry.status === "matched").length;
  const drifted = comparison.filter((entry) => entry.status === "drifted").length;
  console.log(`PASS monitor=${monitor.id} policies=3 matched=${matched} drifted=${drifted}; protected result: ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
