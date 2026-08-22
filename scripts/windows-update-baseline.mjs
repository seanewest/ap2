import fs from "node:fs";
import path from "node:path";
import { ClientCertificateCredential } from "@azure/identity";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

export const STUDENT_TENANT_ID = "92563293-315c-4b6c-9b90-bcb47ee8c970";
export const RETAINED_DEVICE_NAMES = Object.freeze([
  "ap2fastrachel",
  "ap2homerfresh",
  "ap2kobefresh",
  "ap2margev7",
]);
export const BASELINE_NAMES = Object.freeze({
  group: "AP2 retained managed Windows endpoints",
  ring: "AP2 retained endpoints - Monthly quality updates",
  feature: "AP2 retained endpoints - Windows 11 24H2",
});

export function updateRingBody() {
  return {
    "@odata.type": "#microsoft.graph.windowsUpdateForBusinessConfiguration",
    displayName: BASELINE_NAMES.ring,
    description: "Standing AP2 retained-endpoint quality/security update baseline.",
    roleScopeTagIds: ["0"],
    microsoftUpdateServiceAllowed: true,
    driversExcluded: true,
    qualityUpdatesDeferralPeriodInDays: 3,
    featureUpdatesDeferralPeriodInDays: 0,
    allowWindows11Upgrade: false,
    qualityUpdatesPaused: false,
    featureUpdatesPaused: false,
    businessReadyUpdatesOnly: "userDefined",
    skipChecksBeforeRestart: false,
    automaticUpdateMode: "windowsDefault",
    userPauseAccess: "disabled",
    userWindowsUpdateScanAccess: "disabled",
    updateNotificationLevel: "restartWarningsOnly",
    featureUpdatesRollbackWindowInDays: 10,
    deadlineForFeatureUpdatesInDays: 14,
    deadlineForQualityUpdatesInDays: 7,
    deadlineGracePeriodInDays: 2,
    postponeRebootUntilAfterDeadline: false,
  };
}

export function featureUpdateBody() {
  return {
    "@odata.type": "#microsoft.graph.windowsFeatureUpdateProfile",
    displayName: BASELINE_NAMES.feature,
    description: "Hold retained AP2 endpoints on supported Windows 11 24H2 until a deliberate baseline change.",
    featureUpdateVersion: "Windows 11, version 24H2",
    roleScopeTagIds: ["0"],
    installLatestWindows10OnWindows11IneligibleDevice: false,
    installFeatureUpdatesOptional: false,
  };
}

export function summarizeManagedDevice(device) {
  return {
    id: device.id,
    deviceName: device.deviceName,
    azureADDeviceId: device.azureADDeviceId,
    operatingSystem: device.operatingSystem,
    osVersion: device.osVersion,
    complianceState: device.complianceState,
    managementAgent: device.managementAgent,
    updatePolicyEligible: device.managementAgent === "mdm",
    lastSyncDateTime: device.lastSyncDateTime,
    userPrincipalName: device.userPrincipalName || null,
    model: device.model,
  };
}

export function summarizeDeviceStatus(status) {
  return {
    deviceDisplayName: status.deviceDisplayName,
    userPrincipalName: status.userPrincipalName || null,
    status: status.status,
    lastReportedDateTime: status.lastReportedDateTime,
  };
}

export function assertRetainedInventory(devices) {
  const byName = new Map();
  for (const device of devices) {
    const key = device.deviceName?.toLowerCase();
    if (!RETAINED_DEVICE_NAMES.includes(key)) continue;
    if (byName.has(key)) throw new Error(`Duplicate retained Intune record for ${key}`);
    byName.set(key, device);
  }
  if (byName.size !== RETAINED_DEVICE_NAMES.length) {
    const missing = RETAINED_DEVICE_NAMES.filter((name) => !byName.has(name));
    throw new Error(`Missing retained Intune device(s): ${missing.join(", ")}`);
  }
  const retained = RETAINED_DEVICE_NAMES.map((name) => byName.get(name));
  for (const device of retained) {
    const allowedAgents = device.deviceName.toLowerCase() === "ap2homerfresh"
      ? new Set(["mdm", "msSense"])
      : new Set(["mdm"]);
    if (device.operatingSystem !== "Windows" || !allowedAgents.has(device.managementAgent)) {
      throw new Error(`${device.deviceName} has unexpected management state (${device.managementAgent})`);
    }
    if (!device.azureADDeviceId) throw new Error(`${device.deviceName} has no Entra device binding`);
    const [major, minor, build] = String(device.osVersion ?? "").split(".").map(Number);
    if (major !== 10 || minor !== 0 || !Number.isInteger(build) || build < 26100) {
      throw new Error(`${device.deviceName} is below the retained Windows 11 24H2 baseline (${device.osVersion})`);
    }
  }
  return retained;
}

export function assertRingShape(actual) {
  const expected = updateRingBody();
  for (const [key, value] of Object.entries(expected)) {
    if (key === "@odata.type" || key === "roleScopeTagIds") continue;
    if (JSON.stringify(actual[key]) !== JSON.stringify(value)) {
      throw new Error(`Unexpected update-ring setting: ${key}`);
    }
  }
}

export function assertFeatureShape(actual) {
  const expected = featureUpdateBody();
  for (const [key, value] of Object.entries(expected)) {
    if (key === "@odata.type" || key === "roleScopeTagIds") continue;
    if (JSON.stringify(actual[key]) !== JSON.stringify(value)) {
      throw new Error(`Unexpected feature-update setting: ${key}`);
    }
  }
}

async function main() {
  const mode = process.argv[2];
  if (!new Set(["inspect", "reconcile", "observe"]).has(mode)) {
    throw new Error("mode must be inspect, reconcile, or observe");
  }
  const runtime = resolveAp2RuntimeRoot();
  const config = JSON.parse(fs.readFileSync(
    path.join(runtime, "secrets/dev-graph/config.json"),
    "utf8",
  ));
  if (config.tenantId !== STUDENT_TENANT_ID) {
    throw new Error("Dev credential is not bound to the development Student tenant");
  }
  const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
    certificatePath: path.join(runtime, "secrets/dev-graph/credential.pem"),
  });
  const token = (await credential.getToken("https://graph.microsoft.com/.default"))?.token;
  if (!token) throw new Error("Graph token acquisition failed");

  const graph = async (pathname, init = {}, accepted = [200]) => {
    const response = await fetch(`https://graph.microsoft.com${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!accepted.includes(response.status)) {
      throw new Error(`${init.method ?? "GET"} ${pathname} -> ${response.status} ${body?.error?.code ?? "unknown"}`);
    }
    return body;
  };

  const list = async (pathname) => {
    const values = [];
    let next = pathname;
    while (next) {
      const page = await graph(next.startsWith("https://") ? next.replace("https://graph.microsoft.com", "") : next);
      values.push(...(page.value ?? []));
      next = page["@odata.nextLink"];
    }
    return values;
  };

  const readState = async () => {
    const [managedDevices, entraDevices, groups, configurations, featureProfiles] = await Promise.all([
      list("/v1.0/deviceManagement/managedDevices?$select=id,deviceName,azureADDeviceId,operatingSystem,osVersion,complianceState,managementAgent,lastSyncDateTime,userPrincipalName,model"),
      list("/v1.0/devices?$select=id,deviceId,displayName,accountEnabled,operatingSystem,operatingSystemVersion,trustType"),
      list(`/v1.0/groups?$filter=displayName eq '${BASELINE_NAMES.group}'&$select=id,displayName,securityEnabled,mailEnabled`),
      list("/v1.0/deviceManagement/deviceConfigurations"),
      list("/beta/deviceManagement/windowsFeatureUpdateProfiles"),
    ]);
    const retained = assertRetainedInventory(managedDevices);
    const entraByDeviceId = new Map(entraDevices.map((device) => [device.deviceId?.toLowerCase(), device]));
    const retainedEntra = retained.map((device) => entraByDeviceId.get(device.azureADDeviceId.toLowerCase()));
    if (retainedEntra.some((device) => !device || device.accountEnabled !== true)) {
      throw new Error("A retained Intune record lacks one active matching Entra device");
    }
    const rings = configurations.filter((entry) => entry.displayName === BASELINE_NAMES.ring);
    const features = featureProfiles.filter((entry) => entry.displayName === BASELINE_NAMES.feature);
    if (groups.length > 1 || rings.length > 1 || features.length > 1) {
      throw new Error("Duplicate AP2 Windows update baseline object detected");
    }
    const groupMembers = groups.length
      ? await list(`/v1.0/groups/${groups[0].id}/members?$select=id,displayName`)
      : [];
    const ringAssignments = rings.length
      ? await list(`/v1.0/deviceManagement/deviceConfigurations/${rings[0].id}/assignments`)
      : [];
    const featureAssignments = features.length
      ? await list(`/beta/deviceManagement/windowsFeatureUpdateProfiles/${features[0].id}/assignments`)
      : [];
    const ringStatuses = rings.length && mode === "observe"
      ? await list(`/v1.0/deviceManagement/deviceConfigurations/${rings[0].id}/deviceStatuses`)
      : [];
    return {
      retained,
      retainedEntra,
      group: groups[0],
      groupMembers,
      ring: rings[0],
      ringAssignments,
      feature: features[0],
      featureAssignments,
      ringStatuses,
    };
  };

  let state = await readState();
  if (mode === "reconcile") {
    if (state.group && (state.group.securityEnabled !== true || state.group.mailEnabled !== false)) {
      throw new Error("Existing baseline group has an unexpected type");
    }
    if (!state.group) {
      state.group = await graph("/v1.0/groups", {
        method: "POST",
        body: JSON.stringify({
          displayName: BASELINE_NAMES.group,
          description: "Standing scope for AP2 retained managed Windows endpoints.",
          mailEnabled: false,
          mailNickname: "ap2-retained-managed-windows-endpoints",
          securityEnabled: true,
        }),
      }, [201]);
    }
    const wantedMemberIds = new Set(state.retainedEntra.map((device) => device.id));
    const existingMemberIds = new Set(state.groupMembers.map((member) => member.id));
    for (const memberId of existingMemberIds) {
      if (!wantedMemberIds.has(memberId)) {
        await graph(`/v1.0/groups/${state.group.id}/members/${memberId}/$ref`, { method: "DELETE" }, [204]);
      }
    }
    for (const memberId of wantedMemberIds) {
      if (!existingMemberIds.has(memberId)) {
        await graph(`/v1.0/groups/${state.group.id}/members/$ref`, {
          method: "POST",
          body: JSON.stringify({ "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${memberId}` }),
        }, [204]);
      }
    }
    if (!state.ring) {
      state.ring = await graph("/v1.0/deviceManagement/deviceConfigurations", {
        method: "POST",
        body: JSON.stringify(updateRingBody()),
      }, [201]);
    } else {
      assertRingShape(state.ring);
    }
    await graph(`/v1.0/deviceManagement/deviceConfigurations/${state.ring.id}/assign`, {
      method: "POST",
      body: JSON.stringify({
        assignments: [{ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: state.group.id } }],
      }),
    }, [200, 204]);
    if (!state.feature) {
      state.feature = await graph("/beta/deviceManagement/windowsFeatureUpdateProfiles", {
        method: "POST",
        body: JSON.stringify(featureUpdateBody()),
      }, [201]);
    } else {
      assertFeatureShape(state.feature);
    }
    const featureGroupIds = new Set(state.featureAssignments.map((assignment) => assignment.target?.groupId));
    if (!featureGroupIds.has(state.group.id)) {
      await graph(`/beta/deviceManagement/windowsFeatureUpdateProfiles/${state.feature.id}/assign`, {
        method: "POST",
        body: JSON.stringify({
          assignments: [{
            "@odata.type": "#microsoft.graph.windowsFeatureUpdateProfileAssignment",
            target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: state.group.id },
          }],
        }),
      }, [200, 204]);
    }
    state = await readState();
  }

  if (state.ring) assertRingShape(state.ring);
  if (state.feature) assertFeatureShape(state.feature);
  const expectedMemberIds = new Set(state.retainedEntra.map((device) => device.id));
  const assignmentIsExact = (assignments) => assignments.length === 1 &&
    assignments[0].target?.groupId === state.group?.id;
  const result = {
    observedUtc: new Date().toISOString(),
    mode,
    retainedDevices: state.retained.map(summarizeManagedDevice),
    scope: state.group ? {
      id: state.group.id,
      displayName: state.group.displayName,
      memberCount: state.groupMembers.length,
      exactRetainedMembership: state.groupMembers.length === expectedMemberIds.size &&
        state.groupMembers.every((member) => expectedMemberIds.has(member.id)),
    } : null,
    updateRing: state.ring ? {
      id: state.ring.id,
      displayName: state.ring.displayName,
      settings: updateRingBody(),
      exactAssignment: assignmentIsExact(state.ringAssignments),
      deviceStatuses: state.ringStatuses.map(summarizeDeviceStatus),
    } : null,
    featureUpdate: state.feature ? {
      id: state.feature.id,
      displayName: state.feature.displayName,
      featureUpdateVersion: state.feature.featureUpdateVersion,
      endOfSupportDate: state.feature.endOfSupportDate,
      exactAssignment: assignmentIsExact(state.featureAssignments),
      retainedDevicesAtOrBeyondTarget: state.retained.every((device) => {
        const build = Number(String(device.osVersion ?? "").split(".")[2]);
        return Number.isInteger(build) && build >= 26100;
      }),
    } : null,
  };
  if (mode !== "inspect") {
    if (!result.scope?.exactRetainedMembership || !result.updateRing?.exactAssignment ||
        !result.featureUpdate?.exactAssignment) {
      throw new Error("Windows update baseline did not reconcile to the exact retained scope");
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
