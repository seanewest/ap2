import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ClientCertificateCredential } from "@azure/identity";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

const TENANT_ID = "92563293-315c-4b6c-9b90-bcb47ee8c970";
const GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";
const INTUNE_PERMISSION = "DeviceManagementApps.ReadWrite.All";
const DEVICE_GROUP_NAME = "AP2 retained managed Windows endpoints";
const USER_GROUP_NAME = "AP2 retained managed Windows users";
const APP_NAME = "Microsoft Global Secure Access client 2.31.125";
const CLIENT_VERSION = "2.31.125";
const ENTRA_SUITE_SKU_ID = "f9602137-2203-447b-9fff-41b36e08ce5d";
const USER_IDS = new Map([
  ["6e54e3a9-7651-4520-a331-047550ae6fca", "Homer Simpson"],
  ["646cb944-5637-4410-bfc6-f338598e5804", "Kobe West"],
  ["9b7fc1a3-58a0-4440-8d09-796e4d405acd", "Marge Simpson"],
  ["1e99b11d-f3b0-4e6f-86b5-1b4bf95012e9", "Rachel Green"],
]);
const PROFILE_SPS = Object.freeze([
  { type: "m365", name: "GSA-Microsoft365trafficforwardingprofile" },
  { type: "internet", name: "GSA-Internettrafficforwardingprofile" },
]);
const DEFAULT_APP_ROLE_ID = "00000000-0000-0000-0000-000000000000";
const MODE = process.argv[2];
const PACKAGE = process.argv[3];
if (!new Set(["inspect", "reconcile", "observe"]).has(MODE)) {
  throw new Error("mode must be inspect, reconcile, or observe");
}
if (MODE === "reconcile" && (!PACKAGE || !fs.existsSync(PACKAGE))) {
  throw new Error("reconcile mode requires the prepared .intunewin package path");
}

const runtime = resolveAp2RuntimeRoot();
const config = JSON.parse(fs.readFileSync(path.join(runtime, "secrets/dev-graph/config.json"), "utf8"));
if (config.tenantId !== TENANT_ID) throw new Error("Dev credential is not bound to the Student tenant");
const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
  certificatePath: path.join(runtime, "secrets/dev-graph/credential.pem"),
});
let access = await credential.getToken("https://graph.microsoft.com/.default");
if (!access?.token) throw new Error("Graph token acquisition failed");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function graph(pathname, init = {}, accepted = [200]) {
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
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!accepted.includes(response.status)) {
    throw new Error(`${init.method ?? "GET"} ${pathname} -> ${response.status} ${body?.error?.code ?? String(body).slice(0, 180)}`);
  }
  return { response, body };
}

async function list(pathname) {
  const values = [];
  let next = pathname;
  while (next) {
    const { body } = await graph(next.startsWith("https://") ? next.replace("https://graph.microsoft.com", "") : next);
    values.push(...(body.value ?? []));
    next = body["@odata.nextLink"];
  }
  return values;
}

async function servicePrincipalByAppId(appId) {
  const filter = encodeURIComponent(`appId eq '${appId}'`);
  const matches = await list(`/v1.0/servicePrincipals?$filter=${filter}&$select=id,appId,displayName,appRoles`);
  if (matches.length !== 1) throw new Error(`Expected one service principal for ${appId}`);
  return matches[0];
}

async function ensureTemporaryIntunePermission() {
  const claims = JSON.parse(Buffer.from(access.token.split(".")[1], "base64url"));
  const [dev, resource] = await Promise.all([
    servicePrincipalByAppId(config.clientId),
    servicePrincipalByAppId(GRAPH_APP_ID),
  ]);
  const role = resource.appRoles.find((entry) => entry.value === INTUNE_PERMISSION && entry.allowedMemberTypes?.includes("Application"));
  if (!role) throw new Error(`${INTUNE_PERMISSION} is unavailable on Microsoft Graph`);
  const current = await list(`/v1.0/servicePrincipals/${dev.id}/appRoleAssignments`);
  const existing = current.find((entry) => entry.resourceId === resource.id && entry.appRoleId === role.id);
  if (existing && claims.roles?.includes(INTUNE_PERMISSION)) {
    return { created: false, assignmentId: existing.id, devId: dev.id };
  }
  if (!existing && claims.roles?.includes(INTUNE_PERMISSION)) {
    // The assignment has already been removed but its issued token is still usable.
    return { created: false };
  }
  if (existing) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      access = await credential.getToken("https://graph.microsoft.com/.default", { refresh: true });
      if (access?.token) {
        const refreshedClaims = JSON.parse(Buffer.from(access.token.split(".")[1], "base64url"));
        if (refreshedClaims.roles?.includes(INTUNE_PERMISSION)) return { created: false, assignmentId: existing.id, devId: dev.id };
      }
      if (attempt === 29) throw new Error(`${INTUNE_PERMISSION} assignment exists but did not reach a fresh token`);
      await sleep(2000);
    }
  }
  const { body } = await graph(`/v1.0/servicePrincipals/${dev.id}/appRoleAssignments`, {
    method: "POST",
    body: JSON.stringify({ principalId: dev.id, resourceId: resource.id, appRoleId: role.id }),
  }, [201]);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    access = await credential.getToken("https://graph.microsoft.com/.default", { refresh: true });
    if (access?.token) {
      const refreshedClaims = JSON.parse(Buffer.from(access.token.split(".")[1], "base64url"));
      if (refreshedClaims.roles?.includes(INTUNE_PERMISSION)) break;
    }
    if (attempt === 29) throw new Error(`${INTUNE_PERMISSION} did not reach a fresh token after the bounded propagation wait`);
    await sleep(2000);
  }
  return { created: true, assignmentId: body.id, devId: dev.id, resourceId: resource.id, appRoleId: role.id };
}

async function removeTemporaryIntunePermission(permission) {
  if (!permission.created) return;
  await graph(`/v1.0/servicePrincipals/${permission.devId}/appRoleAssignments/${permission.assignmentId}`, { method: "DELETE" }, [204, 400, 404]);
  let deleteAttempts = 1;
  let consecutiveAbsentReads = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const assignments = await list(`/v1.0/servicePrincipals/${permission.devId}/appRoleAssignments`);
    const standing = assignments.find((entry) =>
      entry.resourceId === permission.resourceId && entry.appRoleId === permission.appRoleId
    );
    if (!standing) {
      consecutiveAbsentReads += 1;
      if (consecutiveAbsentReads === 5) return;
    } else {
      consecutiveAbsentReads = 0;
    }
    if (standing && deleteAttempts < 3) {
      await graph(`/v1.0/servicePrincipals/${permission.devId}/appRoleAssignments/${standing.id}`, { method: "DELETE" }, [204, 400, 404]);
      deleteAttempts += 1;
    }
    await sleep(2000);
  }
  throw new Error(`${INTUNE_PERMISSION} remains assigned after bounded cleanup reconciliation`);
}

async function exactGroup(displayName) {
  const filter = encodeURIComponent(`displayName eq '${displayName}'`);
  const matches = await list(`/v1.0/groups?$filter=${filter}&$select=id,displayName,description,securityEnabled,mailEnabled`);
  if (matches.length > 1) throw new Error(`More than one group is named ${displayName}`);
  return matches[0];
}

async function ensureUserGroup() {
  let group = await exactGroup(USER_GROUP_NAME);
  let created = false;
  if (!group) {
    ({ body: group } = await graph("/v1.0/groups", {
      method: "POST",
      body: JSON.stringify({
        displayName: USER_GROUP_NAME,
        description: "Standing user scope for GSA traffic acquisition on AP2 retained managed Windows endpoints.",
        mailEnabled: false,
        mailNickname: "ap2-retained-managed-windows-users",
        securityEnabled: true,
      }),
    }, [201]));
    created = true;
  }
  if (!group.securityEnabled || group.mailEnabled) throw new Error("Retained GSA user group has an unexpected type");
  const members = await list(`/v1.0/groups/${group.id}/members?$select=id,displayName,userPrincipalName`);
  const actual = new Set(members.map((entry) => entry.id));
  for (const member of members) {
    if (!USER_IDS.has(member.id)) {
      await graph(`/v1.0/groups/${group.id}/members/${member.id}/$ref`, { method: "DELETE" }, [204]);
    }
  }
  for (const id of USER_IDS.keys()) {
    if (!actual.has(id)) {
      await graph(`/v1.0/groups/${group.id}/members/$ref`, {
        method: "POST",
        body: JSON.stringify({ "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${id}` }),
      }, [204]);
    }
  }
  return { group, created };
}

async function profileState() {
  const profiles = await list("/beta/networkAccess/forwardingProfiles");
  const result = [];
  for (const expected of PROFILE_SPS) {
    const profile = profiles.find((entry) => entry.trafficForwardingType === expected.type);
    if (!profile || profile.state !== "enabled") throw new Error(`${expected.type} forwarding profile is not enabled`);
    const filter = encodeURIComponent(`displayName eq '${expected.name}'`);
    const principals = await list(`/v1.0/servicePrincipals?$filter=${filter}&$select=id,appId,displayName,accountEnabled,appRoleAssignmentRequired,tags,homepage,loginUrl,servicePrincipalType,appOwnerOrganizationId`);
    if (principals.length !== 1) throw new Error(`Expected one service principal named ${expected.name}`);
    const servicePrincipal = principals[0];
    const assignments = await list(`/v1.0/servicePrincipals/${servicePrincipal.id}/appRoleAssignedTo?$select=id,appRoleId,principalId,principalDisplayName,principalType,createdDateTime`);
    result.push({ profile, servicePrincipal, assignments });
  }
  return result;
}

async function reconcileProfileAssignments(group, profiles) {
  for (const entry of profiles) {
    const tags = new Set(entry.servicePrincipal.tags ?? []);
    if (!tags.has("HideApp")) {
      tags.add("HideApp");
      await graph(`/v1.0/servicePrincipals/${entry.servicePrincipal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ tags: [...tags] }),
      }, [204]);
    }
    const wanted = entry.assignments.find((assignment) => assignment.principalId === group.id);
    if (!wanted) {
      const accepted = await graph(`/v1.0/groups/${group.id}/appRoleAssignments`, {
        method: "POST",
        body: JSON.stringify({ principalId: group.id, resourceId: entry.servicePrincipal.id, appRoleId: DEFAULT_APP_ROLE_ID }),
      }, [201, 400]);
      if (accepted.response.status === 400) {
        const current = await list(`/v1.0/servicePrincipals/${entry.servicePrincipal.id}/appRoleAssignedTo?$select=id,principalId`);
        if (!current.some((assignment) => assignment.principalId === group.id)) {
          throw new Error(`Group assignment for ${entry.profile.trafficForwardingType} was rejected and did not become observable`);
        }
      }
    }
    for (const assignment of entry.assignments) {
      if (assignment.principalId !== group.id) {
        await graph(`/v1.0/servicePrincipals/${entry.servicePrincipal.id}/appRoleAssignedTo/${assignment.id}`, { method: "DELETE" }, [204]);
      }
    }
  }
}

function xmlValue(xml, name) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  if (!match) throw new Error(`Package metadata lacks ${name}`);
  return match[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

function packageMetadata(packagePath) {
  const xml = execFileSync("unzip", ["-p", packagePath, "*Detection.xml"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const entries = execFileSync("unzip", ["-Z1", packagePath], { encoding: "utf8" }).trim().split(/\r?\n/);
  const encryptedEntry = entries.find((entry) => /Contents\/.+\.intunewin$/i.test(entry));
  if (!encryptedEntry) throw new Error("Package lacks encrypted Intune content");
  return {
    encryptedEntry,
    encryptedName: path.basename(encryptedEntry),
    setupFile: xmlValue(xml, "SetupFile"),
    unencryptedSize: Number(xmlValue(xml, "UnencryptedContentSize")),
    encryptionInfo: {
      encryptionKey: xmlValue(xml, "EncryptionKey"),
      macKey: xmlValue(xml, "MacKey"),
      initializationVector: xmlValue(xml, "InitializationVector"),
      mac: xmlValue(xml, "Mac"),
      profileIdentifier: "ProfileVersion1",
      fileDigest: xmlValue(xml, "FileDigest"),
      fileDigestAlgorithm: xmlValue(xml, "FileDigestAlgorithm"),
    },
  };
}

async function waitForFile(fileUri, success) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const { body } = await graph(fileUri);
    if (body.uploadState === success) return body;
    if (/fail|error/i.test(body.uploadState ?? "")) throw new Error(`Intune content processing reached ${body.uploadState}`);
    await sleep(3000);
  }
  throw new Error(`Intune content processing did not reach ${success}`);
}

async function uploadBlockBlob(sasUrl, filePath) {
  const handle = fs.openSync(filePath, "r");
  const blockIds = [];
  const blockSize = 4 * 1024 * 1024;
  try {
    let position = 0;
    for (let index = 0; ; index += 1) {
      const buffer = Buffer.allocUnsafe(blockSize);
      const count = fs.readSync(handle, buffer, 0, blockSize, position);
      if (!count) break;
      const blockId = Buffer.from(String(index).padStart(6, "0")).toString("base64");
      const url = new URL(sasUrl);
      url.searchParams.set("comp", "block");
      url.searchParams.set("blockid", blockId);
      const response = await fetch(url, { method: "PUT", headers: { "x-ms-version": "2023-11-03" }, body: buffer.subarray(0, count) });
      if (!response.ok) throw new Error(`Azure block upload ${index} -> ${response.status}`);
      blockIds.push(blockId);
      position += count;
    }
    const url = new URL(sasUrl);
    url.searchParams.set("comp", "blocklist");
    const body = `<?xml version="1.0" encoding="utf-8"?><BlockList>${blockIds.map((id) => `<Latest>${id}</Latest>`).join("")}</BlockList>`;
    const response = await fetch(url, { method: "PUT", headers: { "x-ms-version": "2023-11-03", "Content-Type": "application/xml" }, body });
    if (!response.ok) throw new Error(`Azure block-list commit -> ${response.status}`);
  } finally {
    fs.closeSync(handle);
  }
}

function appBody(metadata) {
  return {
    "@odata.type": "#microsoft.graph.win32LobApp",
    displayName: APP_NAME,
    description: "Microsoft Global Secure Access Windows client deployed to AP2 retained managed endpoints through Intune.",
    publisher: "Microsoft",
    developer: "Microsoft",
    owner: "AP2",
    notes: "Standing managed GSA client baseline.",
    informationUrl: "https://learn.microsoft.com/entra/global-secure-access/how-to-install-windows-client",
    privacyInformationUrl: "https://privacy.microsoft.com/privacystatement",
    isFeatured: false,
    fileName: metadata.encryptedName,
    setupFilePath: metadata.setupFile,
    installCommandLine: `powershell.exe -ExecutionPolicy Bypass -File ${metadata.setupFile}`,
    uninstallCommandLine: '"GlobalSecureAccessClient.exe" /uninstall /quiet /norestart',
    installExperience: { runAsAccount: "system", deviceRestartBehavior: "basedOnReturnCode" },
    minimumSupportedOperatingSystem: { v10_1607: true },
    applicableArchitectures: "x64",
    runAs32bit: false,
    msiInformation: null,
    rules: [{
      "@odata.type": "#microsoft.graph.win32LobAppFileSystemRule",
      ruleType: "detection",
      path: "C:\\Program Files\\Global Secure Access Client\\TrayApp",
      fileOrFolderName: "GlobalSecureAccessClient.exe",
      check32BitOn64System: false,
      operationType: "version",
      operator: "greaterThanOrEqual",
      comparisonValue: CLIENT_VERSION,
    }],
    returnCodes: [
      { returnCode: 0, type: "success" },
      { returnCode: 3010, type: "softReboot" },
      { returnCode: 1618, type: "retry" },
      { returnCode: 1603, type: "failed" },
    ],
  };
}

async function createIntuneApp(packagePath) {
  const metadata = packageMetadata(packagePath);
  const { body: app } = await graph("/beta/deviceAppManagement/mobileApps", { method: "POST", body: JSON.stringify(appBody(metadata)) }, [201]);
  const { body: version } = await graph(`/beta/deviceAppManagement/mobileApps/${app.id}/microsoft.graph.win32LobApp/contentVersions`, { method: "POST", body: "{}" }, [201]);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ap2-gsa-intune-"));
  const encryptedPath = path.join(temporary, metadata.encryptedName);
  try {
    execFileSync("unzip", ["-q", packagePath, metadata.encryptedEntry, "-d", temporary]);
    const extracted = path.join(temporary, metadata.encryptedEntry);
    fs.renameSync(extracted, encryptedPath);
    const encryptedSize = fs.statSync(encryptedPath).size;
    const { body: file } = await graph(`/beta/deviceAppManagement/mobileApps/${app.id}/microsoft.graph.win32LobApp/contentVersions/${version.id}/files`, {
      method: "POST",
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.mobileAppContentFile",
        name: metadata.encryptedName,
        size: metadata.unencryptedSize,
        sizeEncrypted: encryptedSize,
        manifest: null,
        isDependency: false,
      }),
    }, [201]);
    const fileUri = `/beta/deviceAppManagement/mobileApps/${app.id}/microsoft.graph.win32LobApp/contentVersions/${version.id}/files/${file.id}`;
    const ready = await waitForFile(fileUri, "azureStorageUriRequestSuccess");
    await uploadBlockBlob(ready.azureStorageUri, encryptedPath);
    await graph(`${fileUri}/commit`, { method: "POST", body: JSON.stringify({ fileEncryptionInfo: metadata.encryptionInfo }) }, [200, 204]);
    await waitForFile(fileUri, "commitFileSuccess");
    await graph(`/beta/deviceAppManagement/mobileApps/${app.id}`, {
      method: "PATCH",
      body: JSON.stringify({ "@odata.type": "#microsoft.graph.win32LobApp", committedContentVersion: version.id }),
    }, [204]);
  } catch (error) {
    error.message = `Intune app ${app.id} was created but content reconciliation failed: ${error.message}`;
    throw error;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return app;
}

async function intuneAppState() {
  const apps = await list("/beta/deviceAppManagement/mobileApps");
  const matches = apps.filter((entry) => entry.displayName === APP_NAME);
  if (matches.length > 1) throw new Error(`More than one Intune app is named ${APP_NAME}`);
  if (!matches.length) return null;
  const app = matches[0];
  const assignments = await list(`/beta/deviceAppManagement/mobileApps/${app.id}/assignments`);
  const statusRead = await graph(`/beta/deviceAppManagement/mobileApps/${app.id}/deviceStatuses`, {}, [200, 400]);
  const statuses = statusRead.response.ok ? statusRead.body.value ?? [] : [];
  return { app, assignments, statuses };
}

async function assignIntuneApp(app, deviceGroup) {
  await graph(`/v1.0/deviceAppManagement/mobileApps/${app.id}/assign`, {
    method: "POST",
    body: JSON.stringify({
      mobileAppAssignments: [{
        "@odata.type": "#microsoft.graph.mobileAppAssignment",
        intent: "required",
        target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: deviceGroup.id },
        settings: {
          "@odata.type": "#microsoft.graph.win32LobAppAssignmentSettings",
          notifications: "showAll",
          restartSettings: {
            "@odata.type": "#microsoft.graph.win32LobAppRestartSettings",
            gracePeriodInMinutes: 10080,
            countdownDisplayBeforeRestartInMinutes: 15,
            restartNotificationSnoozeDurationInMinutes: 240,
          },
          deliveryOptimizationPriority: "notConfigured",
        },
      }],
    }),
  }, [200, 204]);
}

async function readState(includeIntune = true) {
  const [deviceGroup, userGroup, profiles, users] = await Promise.all([
    exactGroup(DEVICE_GROUP_NAME),
    exactGroup(USER_GROUP_NAME),
    profileState(),
    Promise.all([...USER_IDS.keys()].map((id) => graph(`/v1.0/users/${id}?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses`).then(({ body }) => body))),
  ]);
  const [deviceMembers, userMembers] = await Promise.all([
    deviceGroup ? list(`/v1.0/groups/${deviceGroup.id}/members?$select=id,displayName,deviceId`) : [],
    userGroup ? list(`/v1.0/groups/${userGroup.id}/members?$select=id,displayName,userPrincipalName`) : [],
  ]);
  const app = includeIntune ? await intuneAppState() : "permission-not-present";
  return { observedUtc: new Date().toISOString(), deviceGroup, deviceMembers, userGroup, userMembers, profiles, users, app };
}

function validate(state, requireApp) {
  if (!state.deviceGroup || state.deviceMembers.length !== 4) throw new Error("Retained managed endpoint group is not exact");
  const memberIds = new Set(state.userMembers.map((entry) => entry.id));
  if (!state.userGroup || memberIds.size !== USER_IDS.size || [...USER_IDS.keys()].some((id) => !memberIds.has(id))) {
    throw new Error("Retained managed Windows user group is not exact");
  }
  if (state.users.some((user) => !user.accountEnabled || !user.assignedLicenses?.some((license) => license.skuId === ENTRA_SUITE_SKU_ID))) {
    throw new Error("A retained managed Windows user is disabled or lacks Entra Suite licensing");
  }
  for (const entry of state.profiles) {
    if (entry.assignments.length !== 1 || entry.assignments[0].principalId !== state.userGroup.id || entry.assignments[0].principalType !== "Group") {
      throw new Error(`${entry.profile.trafficForwardingType} forwarding is not assigned only through the retained user group`);
    }
    if (!(entry.servicePrincipal.tags ?? []).includes("HideApp")) {
      throw new Error(`${entry.profile.trafficForwardingType} forwarding enterprise application is visible in My Apps`);
    }
  }
  if (requireApp) {
    if (!state.app?.app || state.app.app.committedContentVersion === "0") throw new Error("The managed GSA client app lacks committed content");
    if (state.app.assignments.length !== 1 || state.app.assignments[0].intent !== "required" || state.app.assignments[0].target?.groupId !== state.deviceGroup.id) {
      throw new Error("The managed GSA client app is not required only for the retained device group");
    }
  }
}

function summarize(state) {
  return {
    observedUtc: state.observedUtc,
    scope: {
      deviceGroup: state.deviceGroup && { id: state.deviceGroup.id, displayName: state.deviceGroup.displayName, members: state.deviceMembers.map((entry) => entry.displayName).sort() },
      userGroup: state.userGroup && { id: state.userGroup.id, displayName: state.userGroup.displayName, members: state.userMembers.map((entry) => entry.userPrincipalName).sort() },
    },
    profiles: state.profiles.map((entry) => ({
      id: entry.profile.id,
      type: entry.profile.trafficForwardingType,
      state: entry.profile.state,
      assignment: entry.assignments.map((assignment) => ({ principalId: assignment.principalId, principalDisplayName: assignment.principalDisplayName, principalType: assignment.principalType })),
      applicationExposure: {
        servicePrincipalId: entry.servicePrincipal.id,
        appOwnerOrganizationId: entry.servicePrincipal.appOwnerOrganizationId,
        tenantGenerated: entry.servicePrincipal.appOwnerOrganizationId === TENANT_ID,
        tags: entry.servicePrincipal.tags ?? [],
        hiddenFromMyApps: (entry.servicePrincipal.tags ?? []).includes("HideApp"),
        homepage: entry.servicePrincipal.homepage,
        loginUrl: entry.servicePrincipal.loginUrl,
        assignmentRequired: entry.servicePrincipal.appRoleAssignmentRequired,
      },
    })),
    users: state.users.map((user) => ({ id: user.id, displayName: user.displayName, userPrincipalName: user.userPrincipalName, accountEnabled: user.accountEnabled, entraSuiteLicensed: user.assignedLicenses?.some((license) => license.skuId === ENTRA_SUITE_SKU_ID) })),
    intuneApp: state.app === "permission-not-present" ? state.app : state.app && {
      id: state.app.app.id,
      displayName: state.app.app.displayName,
      publisher: state.app.app.publisher,
      committedContentVersion: state.app.app.committedContentVersion,
      assignments: state.app.assignments.map((entry) => ({ intent: entry.intent, target: entry.target, settings: entry.settings })),
      deviceStatuses: state.app.statuses,
    },
  };
}

let permission;
try {
  if (MODE === "inspect") {
    const roles = JSON.parse(Buffer.from(access.token.split(".")[1], "base64url")).roles ?? [];
    console.log(JSON.stringify(summarize(await readState(roles.includes(INTUNE_PERMISSION))), null, 2));
  } else {
    permission = await ensureTemporaryIntunePermission();
    if (MODE === "reconcile") {
      const deviceGroup = await exactGroup(DEVICE_GROUP_NAME);
      if (!deviceGroup) throw new Error("The W76 retained managed endpoint group is absent");
      const { group } = await ensureUserGroup();
      const profiles = await profileState();
      await reconcileProfileAssignments(group, profiles);
      let appState = await intuneAppState();
      const app = appState?.app ?? await createIntuneApp(PACKAGE);
      await assignIntuneApp(app, deviceGroup);
    }
    const final = await readState(true);
    validate(final, true);
    console.log(JSON.stringify(summarize(final), null, 2));
  }
} finally {
  if (permission) await removeTemporaryIntunePermission(permission);
}
