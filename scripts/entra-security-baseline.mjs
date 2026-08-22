import fs from "node:fs";
import path from "node:path";
import { ClientCertificateCredential } from "@azure/identity";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

export const STUDENT_TENANT_ID = "92563293-315c-4b6c-9b90-bcb47ee8c970";
export const BASELINE_POLICIES = Object.freeze({
  mfa: "AP2 baseline - Require MFA for all users",
  legacy: "AP2 baseline - Block legacy authentication",
  deviceCode: "AP2 baseline - Block device code flow",
});
export const RETAINED_YOUTRACK_POLICY_IDS = Object.freeze([
  "fe9e0dfa-06b8-433c-9c89-23d9b1345334",
  "ad0f2a27-e0c6-4f54-b23f-9adcb8f08da7",
]);
export const DEFAULT_PASSKEY_PROFILE_ID = "00000000-0000-0000-0000-000000000001";
export const WINDOWS_HELLO_PASSKEY_PROFILE_ID = "a71d5820-68f6-417f-a4ef-19c5577ea0a5";
export const WINDOWS_HELLO_PASSKEY_AAGUIDS = Object.freeze([
  "08987058-cadc-4b81-b6e1-30de50dcbe96",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2",
]);
export const WINDOWS_HELLO_PASSKEY_PROFILE = Object.freeze({
  id: WINDOWS_HELLO_PASSKEY_PROFILE_ID,
  name: "AP2 Windows Hello passkeys",
  passkeyTypes: "deviceBound",
  attestationEnforcement: "disabled",
  keyRestrictions: {
    isEnforced: true,
    enforcementType: "allow",
    aaGuids: WINDOWS_HELLO_PASSKEY_AAGUIDS,
  },
});

const RUN_ID = process.env.AP2_RUN_ID?.trim();
const MODE = process.argv[2];
const RUNTIME = resolveAp2RuntimeRoot();
const OUTPUT = RUN_ID ? path.join(RUNTIME, "runs", RUN_ID) : undefined;

export function baselinePolicyBodies(state = "enabledForReportingButNotEnforced") {
  const allUsersAllResources = {
    users: {
      includeUsers: ["All"],
      excludeUsers: [],
      includeGroups: [],
      excludeGroups: [],
      includeRoles: [],
      excludeRoles: [],
    },
    applications: {
      includeApplications: ["All"],
      excludeApplications: [],
      includeUserActions: [],
      includeAuthenticationContextClassReferences: [],
    },
  };
  return [
    {
      displayName: BASELINE_POLICIES.mfa,
      state,
      conditions: {
        ...structuredClone(allUsersAllResources),
        clientAppTypes: ["all"],
      },
      grantControls: { operator: "OR", builtInControls: ["mfa"] },
    },
    {
      displayName: BASELINE_POLICIES.legacy,
      state,
      conditions: {
        ...structuredClone(allUsersAllResources),
        clientAppTypes: ["exchangeActiveSync", "other"],
      },
      grantControls: { operator: "OR", builtInControls: ["block"] },
    },
    {
      displayName: BASELINE_POLICIES.deviceCode,
      state,
      conditions: {
        ...structuredClone(allUsersAllResources),
        clientAppTypes: ["all"],
        authenticationFlows: { transferMethods: "deviceCodeFlow" },
      },
      grantControls: { operator: "OR", builtInControls: ["block"] },
    },
  ];
}

export function summarizePolicy(policy) {
  return {
    id: policy.id,
    displayName: policy.displayName,
    state: policy.state,
    createdDateTime: policy.createdDateTime,
    modifiedDateTime: policy.modifiedDateTime,
    conditions: {
      users: policy.conditions?.users,
      applications: policy.conditions?.applications,
      clientAppTypes: policy.conditions?.clientAppTypes,
      authenticationFlows: policy.conditions?.authenticationFlows,
      userRiskLevels: policy.conditions?.userRiskLevels,
      signInRiskLevels: policy.conditions?.signInRiskLevels,
      platforms: policy.conditions?.platforms,
      locations: policy.conditions?.locations,
      devices: policy.conditions?.devices,
    },
    grantControls: policy.grantControls,
    sessionControls: policy.sessionControls,
  };
}

export function assertExpectedPolicyShape(actual, expected, expectedState) {
  if (actual.displayName !== expected.displayName || actual.state !== expectedState) {
    throw new Error(`Unexpected baseline identity/state for ${expected.displayName}`);
  }
  const subset = {
    displayName: actual.displayName,
    state: actual.state,
    conditions: {
      users: {
        includeUsers: actual.conditions?.users?.includeUsers ?? [],
        excludeUsers: actual.conditions?.users?.excludeUsers ?? [],
        includeGroups: actual.conditions?.users?.includeGroups ?? [],
        excludeGroups: actual.conditions?.users?.excludeGroups ?? [],
        includeRoles: actual.conditions?.users?.includeRoles ?? [],
        excludeRoles: actual.conditions?.users?.excludeRoles ?? [],
      },
      applications: {
        includeApplications: actual.conditions?.applications?.includeApplications ?? [],
        excludeApplications: actual.conditions?.applications?.excludeApplications ?? [],
        includeUserActions: actual.conditions?.applications?.includeUserActions ?? [],
        includeAuthenticationContextClassReferences:
          actual.conditions?.applications?.includeAuthenticationContextClassReferences ?? [],
      },
      clientAppTypes: actual.conditions?.clientAppTypes ?? [],
      ...(expected.conditions.authenticationFlows
        ? { authenticationFlows: actual.conditions?.authenticationFlows }
        : {}),
    },
    grantControls: {
      operator: actual.grantControls?.operator,
      builtInControls: actual.grantControls?.builtInControls ?? [],
    },
  };
  if (JSON.stringify(subset) !== JSON.stringify({ ...expected, state: expectedState })) {
    throw new Error(`Unexpected baseline shape for ${expected.displayName}`);
  }
  const forbidden = [
    actual.conditions?.userRiskLevels,
    actual.conditions?.signInRiskLevels,
    actual.conditions?.platforms,
    actual.conditions?.locations,
    actual.conditions?.devices,
    actual.sessionControls,
  ];
  if (forbidden.some((value) => value && (!Array.isArray(value) || value.length))) {
    throw new Error(`Unrelated condition/control appeared in ${expected.displayName}`);
  }
}

async function main() {
  if (!RUN_ID || !/^AP2-ENTRA-BASELINE-[0-9]{8}T[0-9]{6}Z$/.test(RUN_ID)) {
    throw new Error("AP2_RUN_ID must be AP2-ENTRA-BASELINE-YYYYMMDDTHHMMSSZ");
  }
  if (!new Set(["inspect", "stage", "enable", "observe"]).has(MODE)) {
    throw new Error("mode must be inspect, stage, enable, or observe");
  }
  fs.mkdirSync(OUTPUT, { recursive: true, mode: 0o700 });
  const config = JSON.parse(fs.readFileSync(
    path.join(RUNTIME, "secrets/dev-graph/config.json"),
    "utf8",
  ));
  if (config.tenantId !== STUDENT_TENANT_ID) {
    throw new Error("Dev credential is not bound to the development Student tenant");
  }
  const credential = new ClientCertificateCredential(
    config.tenantId,
    config.clientId,
    { certificatePath: path.join(RUNTIME, "secrets/dev-graph/credential.pem") },
  );
  const access = await credential.getToken("https://graph.microsoft.com/.default");
  if (!access?.token) throw new Error("Graph token acquisition failed");

  const graph = async (pathname, init = {}) => {
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
      throw new Error(`${init.method ?? "GET"} ${pathname} -> ${response.status} ${body?.error?.code ?? "unknown"}`);
    }
    return body;
  };

  const readState = async () => {
    const [defaults, policies, x509, fido, adminMethods, operator] = await Promise.all([
      graph("/v1.0/policies/identitySecurityDefaultsEnforcementPolicy"),
      graph("/v1.0/identity/conditionalAccess/policies"),
      graph("/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/x509Certificate"),
      graph("/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/fido2"),
      graph("/v1.0/users/5ce59710-7ea3-448c-bd7b-8e8d2b75bb1f/authentication/methods"),
      graph("/v1.0/users/ba97e987-da4c-43e1-ab79-3daa8014440e?$select=id,userPrincipalName,accountEnabled"),
    ]);
    return {
      observedUtc: new Date().toISOString(),
      securityDefaultsEnabled: defaults.isEnabled,
      policies: policies.value,
      x509: {
        state: x509.state,
        includeTargets: x509.includeTargets,
        excludeTargets: x509.excludeTargets,
        authenticationModeConfiguration: x509.authenticationModeConfiguration,
      },
      fido: {
        state: fido.state,
        includeTargets: fido.includeTargets,
        excludeTargets: fido.excludeTargets,
        isSelfServiceRegistrationAllowed: fido.isSelfServiceRegistrationAllowed,
        isAttestationEnforced: fido.isAttestationEnforced,
        keyRestrictions: fido.keyRestrictions,
        defaultPasskeyProfile: fido.defaultPasskeyProfile,
        passkeyProfiles: fido.passkeyProfiles,
      },
      recovery: {
        humanAdminMethodTypes: adminMethods.value.map((method) => method["@odata.type"]).sort(),
        cbaOperator: operator,
      },
    };
  };

  const validateSharedBoundary = (state) => {
    if (state.securityDefaultsEnabled !== false) throw new Error("Security Defaults unexpectedly changed");
    const retained = state.policies.filter((policy) => RETAINED_YOUTRACK_POLICY_IDS.includes(policy.id));
    if (retained.length !== 2 || retained.some((policy) => policy.state !== "enabled")) {
      throw new Error("The two retained YouTrack policies are not intact and enabled");
    }
    if (
      state.x509.state !== "enabled" ||
      state.x509.authenticationModeConfiguration?.x509CertificateAuthenticationDefaultMode !== "x509CertificateMultiFactor" ||
      state.x509.authenticationModeConfiguration?.x509CertificateDefaultRequiredAffinityLevel !== "high" ||
      state.x509.excludeTargets.length !== 0
    ) throw new Error("CBA is not the expected high-affinity multifactor policy");
    if (
      state.fido.state !== "enabled" ||
      state.fido.isSelfServiceRegistrationAllowed !== true ||
      state.fido.isAttestationEnforced !== false ||
      !state.fido.includeTargets.some((target) => target.id === "all_users") ||
      state.fido.excludeTargets.length !== 0
    ) throw new Error("FIDO2/passkey policy changed unexpectedly");
    const allUsers = state.fido.includeTargets.filter((target) => target.id === "all_users");
    const defaultProfile = state.fido.passkeyProfiles.filter((profile) => profile.id === DEFAULT_PASSKEY_PROFILE_ID);
    const windowsProfile = state.fido.passkeyProfiles.filter((profile) => profile.id === WINDOWS_HELLO_PASSKEY_PROFILE_ID);
    if (
      state.fido.defaultPasskeyProfile !== DEFAULT_PASSKEY_PROFILE_ID ||
      state.fido.includeTargets.length !== 1 || allUsers.length !== 1 ||
      JSON.stringify(allUsers[0].allowedPasskeyProfiles) !== JSON.stringify([
        DEFAULT_PASSKEY_PROFILE_ID,
        WINDOWS_HELLO_PASSKEY_PROFILE_ID,
      ]) ||
      defaultProfile.length !== 1 ||
      JSON.stringify({
        id: defaultProfile[0].id,
        name: defaultProfile[0].name,
        passkeyTypes: defaultProfile[0].passkeyTypes,
        attestationEnforcement: defaultProfile[0].attestationEnforcement,
        keyRestrictions: defaultProfile[0].keyRestrictions,
      }) !== JSON.stringify({
        id: DEFAULT_PASSKEY_PROFILE_ID,
        name: "Default passkey profile",
        passkeyTypes: "deviceBound,synced",
        attestationEnforcement: "disabled",
        keyRestrictions: { isEnforced: false, enforcementType: "block", aaGuids: [] },
      }) ||
      windowsProfile.length !== 1 ||
      JSON.stringify(windowsProfile[0]) !== JSON.stringify(WINDOWS_HELLO_PASSKEY_PROFILE)
    ) throw new Error("Passkey profile baseline changed unexpectedly");
    const methodTypes = new Set(state.recovery.humanAdminMethodTypes);
    if (!methodTypes.has("#microsoft.graph.passwordAuthenticationMethod") ||
        !methodTypes.has("#microsoft.graph.microsoftAuthenticatorAuthenticationMethod")) {
      throw new Error("The human administrator recovery method pair is absent");
    }
    if (state.recovery.cbaOperator.accountEnabled !== true) {
      throw new Error("The CBA recovery operator is not enabled");
    }
  };

  const expected = baselinePolicyBodies();
  if (MODE === "stage") {
    const before = await readState();
    validateSharedBoundary(before);
    const existing = before.policies.filter((policy) =>
      Object.values(BASELINE_POLICIES).includes(policy.displayName)
    );
    if (existing.length) throw new Error("A baseline policy already exists; reconcile instead of replaying");
    for (const body of expected) {
      await graph("/v1.0/identity/conditionalAccess/policies", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  if (MODE === "enable") {
    const before = await readState();
    validateSharedBoundary(before);
    const toEnable = [];
    for (const body of expected) {
      const matches = before.policies.filter((policy) => policy.displayName === body.displayName);
      if (matches.length !== 1) throw new Error(`Expected one policy named ${body.displayName}`);
      if (!new Set(["enabledForReportingButNotEnforced", "enabled"]).has(matches[0].state)) {
        throw new Error(`Unexpected state for ${body.displayName}`);
      }
      assertExpectedPolicyShape(matches[0], body, matches[0].state);
      if (matches[0].state === "enabledForReportingButNotEnforced") {
        toEnable.push(matches[0]);
      }
    }
    for (const policy of toEnable) {
      await graph(`/v1.0/identity/conditionalAccess/policies/${policy.id}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "enabled" }),
      });
    }
    if (toEnable.length) await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  const after = await readState();
  validateSharedBoundary(after);
  const baseline = [];
  for (const body of expected) {
    const matches = after.policies.filter((policy) => policy.displayName === body.displayName);
    if (MODE === "inspect" && matches.length === 0) continue;
    if (matches.length !== 1) throw new Error(`Expected one policy named ${body.displayName}`);
    const expectedState = MODE === "inspect"
      ? matches[0].state
      : MODE === "enable" || MODE === "observe"
        ? "enabled"
        : "enabledForReportingButNotEnforced";
    assertExpectedPolicyShape(matches[0], body, expectedState);
    baseline.push(summarizePolicy(matches[0]));
  }
  const result = {
    observedUtc: after.observedUtc,
    studentTenantId: STUDENT_TENANT_ID,
    securityDefaultsEnabled: after.securityDefaultsEnabled,
    retainedYouTrackPolicies: after.policies
      .filter((policy) => RETAINED_YOUTRACK_POLICY_IDS.includes(policy.id))
      .map(summarizePolicy),
    baseline,
    x509: after.x509,
    fido: after.fido,
    recovery: after.recovery,
  };
  const file = path.join(OUTPUT, `${MODE}.json`);
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
