import fs from "node:fs";
import path from "node:path";
import { ClientCertificateCredential } from "@azure/identity";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";
import {
  BASELINE_POLICIES,
  DEFAULT_PASSKEY_PROFILE_ID as DEFAULT_PROFILE_ID,
  RETAINED_YOUTRACK_POLICY_IDS,
  STUDENT_TENANT_ID,
  WINDOWS_HELLO_PASSKEY_AAGUIDS as WINDOWS_HELLO_AAGUIDS,
  WINDOWS_HELLO_PASSKEY_PROFILE as WINDOWS_HELLO_PROFILE,
  WINDOWS_HELLO_PASSKEY_PROFILE_ID as WINDOWS_HELLO_PROFILE_ID,
  assertExpectedPolicyShape,
  baselinePolicyBodies,
  summarizePolicy,
} from "./entra-security-baseline.mjs";

export { DEFAULT_PROFILE_ID, WINDOWS_HELLO_AAGUIDS, WINDOWS_HELLO_PROFILE, WINDOWS_HELLO_PROFILE_ID };

const USER_IDS = Object.freeze({
  homer: "6e54e3a9-7651-4520-a331-047550ae6fca",
  rachel: "1e99b11d-f3b0-4e6f-86b5-1b4bf95012e9",
  kobe: "646cb944-5637-4410-bfc6-f338598e5804",
  admin: "5ce59710-7ea3-448c-bd7b-8e8d2b75bb1f",
});
const CBA_OPERATOR_ID = "ba97e987-da4c-43e1-ab79-3daa8014440e";
const MODE = process.argv[2];
const RUN_ID = process.env.AP2_RUN_ID?.trim();
const runtime = resolveAp2RuntimeRoot();
const output = RUN_ID ? path.join(runtime, "runs", RUN_ID) : undefined;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function plainProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    passkeyTypes: profile.passkeyTypes,
    attestationEnforcement: profile.attestationEnforcement,
    keyRestrictions: {
      isEnforced: profile.keyRestrictions?.isEnforced,
      enforcementType: profile.keyRestrictions?.enforcementType,
      aaGuids: profile.keyRestrictions?.aaGuids ?? [],
    },
  };
}

function plainTarget(target) {
  return {
    targetType: target.targetType,
    id: target.id,
    isRegistrationRequired: target.isRegistrationRequired,
    allowedPasskeyProfiles: target.allowedPasskeyProfiles ?? [],
  };
}

export function isWindowsProfileExact(profile) {
  return JSON.stringify(plainProfile(profile)) === JSON.stringify(WINDOWS_HELLO_PROFILE);
}

export function assertPreflightFido(fido) {
  if (
    fido.state !== "enabled" ||
    fido.isSelfServiceRegistrationAllowed !== true ||
    fido.isAttestationEnforced !== false ||
    fido.keyRestrictions?.isEnforced !== false ||
    fido.keyRestrictions?.enforcementType !== "block" ||
    (fido.keyRestrictions?.aaGuids ?? []).length !== 0 ||
    fido.defaultPasskeyProfile !== DEFAULT_PROFILE_ID ||
    (fido.excludeTargets ?? []).length !== 0
  ) throw new Error("Standing FIDO2 policy is outside the approved boundary");

  const defaults = (fido.passkeyProfiles ?? []).filter((profile) => profile.id === DEFAULT_PROFILE_ID);
  if (defaults.length !== 1 || JSON.stringify(plainProfile(defaults[0])) !== JSON.stringify({
    id: DEFAULT_PROFILE_ID,
    name: "Default passkey profile",
    passkeyTypes: "deviceBound,synced",
    attestationEnforcement: "disabled",
    keyRestrictions: { isEnforced: false, enforcementType: "block", aaGuids: [] },
  })) throw new Error("Default passkey profile changed unexpectedly");

  const targets = (fido.includeTargets ?? []).filter((target) => target.id === "all_users");
  if (
    fido.includeTargets?.length !== 1 || targets.length !== 1 ||
    targets[0].targetType !== "group" || targets[0].isRegistrationRequired !== false
  ) throw new Error("Passkey targeting changed unexpectedly");

  const windowsById = (fido.passkeyProfiles ?? []).filter((profile) => profile.id === WINDOWS_HELLO_PROFILE_ID);
  const windowsByName = (fido.passkeyProfiles ?? []).filter((profile) => profile.name === WINDOWS_HELLO_PROFILE.name);
  if (windowsById.length > 1 || windowsByName.length > 1 ||
      (windowsById.length && !isWindowsProfileExact(windowsById[0])) ||
      (windowsByName.length && windowsByName[0].id !== WINDOWS_HELLO_PROFILE_ID)) {
    throw new Error("A conflicting Windows Hello passkey profile exists");
  }

  const allowed = targets[0].allowedPasskeyProfiles ?? [];
  const complete = windowsById.length === 1 &&
    JSON.stringify(allowed) === JSON.stringify([DEFAULT_PROFILE_ID, WINDOWS_HELLO_PROFILE_ID]);
  const absent = windowsById.length === 0 && JSON.stringify(allowed) === JSON.stringify([DEFAULT_PROFILE_ID]) &&
    fido.passkeyProfiles.length === 1;
  if (!complete && !absent) throw new Error("Passkey profiles or all_users assignments are neither clean pre-state nor exact target state");
  return { complete, defaultProfile: plainProfile(defaults[0]), allUsers: plainTarget(targets[0]) };
}

export function buildPatch(fido) {
  const status = assertPreflightFido(fido);
  if (status.complete) return null;
  return {
    "@odata.type": "#microsoft.graph.fido2AuthenticationMethodConfiguration",
    passkeyProfiles: [status.defaultProfile, structuredClone(WINDOWS_HELLO_PROFILE)],
    includeTargets: [{
      ...status.allUsers,
      allowedPasskeyProfiles: [DEFAULT_PROFILE_ID, WINDOWS_HELLO_PROFILE_ID],
    }],
  };
}

function methodSnapshot(methods) {
  return methods.map((method) => ({
    id: method.id,
    type: method["@odata.type"],
    displayName: method.displayName,
    model: method.model,
    createdDateTime: method.createdDateTime,
  })).sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
}

function selectedPolicies(policies) {
  const names = new Set(Object.values(BASELINE_POLICIES));
  return policies.filter((policy) => names.has(policy.displayName) || RETAINED_YOUTRACK_POLICY_IDS.includes(policy.id))
    .map(summarizePolicy).sort((left, right) => left.id.localeCompare(right.id));
}

async function main() {
  if (!RUN_ID || !/^AP2-WINDOWS-PASSKEY-[0-9]{8}T[0-9]{6}Z$/.test(RUN_ID)) {
    throw new Error("AP2_RUN_ID must be AP2-WINDOWS-PASSKEY-YYYYMMDDTHHMMSSZ");
  }
  if (!new Set(["inspect", "apply"]).has(MODE)) throw new Error("mode must be inspect or apply");
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const config = JSON.parse(fs.readFileSync(path.join(runtime, "secrets/dev-graph/config.json"), "utf8"));
  if (config.tenantId !== STUDENT_TENANT_ID) throw new Error("Dev credential is not bound to the Student tenant");
  const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
    certificatePath: path.join(runtime, "secrets/dev-graph/credential.pem"),
  });
  const access = await credential.getToken("https://graph.microsoft.com/.default");
  if (!access?.token) throw new Error("Graph token acquisition failed");
  const claims = JSON.parse(Buffer.from(access.token.split(".")[1], "base64url"));
  if (MODE === "apply" && !claims.roles?.includes("Policy.ReadWrite.AuthenticationMethod")) {
    throw new Error("Protected identity lacks Policy.ReadWrite.AuthenticationMethod");
  }

  const graph = async (pathname, init = {}) => {
    const response = await fetch(`https://graph.microsoft.com${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json", ...init.headers },
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      throw new Error(`${init.method ?? "GET"} ${pathname} -> ${response.status} ${body?.error?.code ?? "unknown"}`);
    }
    return { response, body };
  };

  const readState = async () => {
    const reads = [
      graph("/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/fido2"),
      graph("/v1.0/policies/identitySecurityDefaultsEnforcementPolicy"),
      graph("/v1.0/identity/conditionalAccess/policies"),
      graph("/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/x509Certificate"),
      graph(`/v1.0/users/${CBA_OPERATOR_ID}?$select=id,userPrincipalName,accountEnabled`),
      ...Object.values(USER_IDS).map((id) => graph(`/v1.0/users/${id}/authentication/methods`)),
    ];
    const [fido, defaults, policies, x509, operator, ...methods] = await Promise.all(reads);
    return {
      observedUtc: new Date().toISOString(),
      fido: fido.body,
      securityDefaultsEnabled: defaults.body.isEnabled,
      policies: policies.body.value,
      x509: x509.body,
      operator: operator.body,
      methods: Object.fromEntries(Object.keys(USER_IDS).map((name, index) => [name, methodSnapshot(methods[index].body.value)])),
    };
  };

  const validateBoundary = (state) => {
    const fido = assertPreflightFido(state.fido);
    if (state.securityDefaultsEnabled !== false) throw new Error("Security Defaults changed unexpectedly");
    if (state.operator.accountEnabled !== true) throw new Error("CBA recovery operator is not enabled");
    if (
      state.x509.state !== "enabled" || state.x509.excludeTargets.length !== 0 ||
      state.x509.authenticationModeConfiguration?.x509CertificateAuthenticationDefaultMode !== "x509CertificateMultiFactor" ||
      state.x509.authenticationModeConfiguration?.x509CertificateDefaultRequiredAffinityLevel !== "high"
    ) throw new Error("CBA recovery policy changed unexpectedly");
    const expected = baselinePolicyBodies("enabled");
    for (const body of expected) {
      const matches = state.policies.filter((policy) => policy.displayName === body.displayName);
      if (matches.length !== 1) throw new Error(`Expected one enabled policy named ${body.displayName}`);
      assertExpectedPolicyShape(matches[0], body, "enabled");
    }
    const youTrack = state.policies.filter((policy) => RETAINED_YOUTRACK_POLICY_IDS.includes(policy.id));
    if (youTrack.length !== 2 || youTrack.some((policy) => policy.state !== "enabled")) {
      throw new Error("Retained YouTrack policies are not intact and enabled");
    }
    const adminTypes = new Set(state.methods.admin.map((method) => method.type));
    if (!adminTypes.has("#microsoft.graph.passwordAuthenticationMethod") ||
        !adminTypes.has("#microsoft.graph.microsoftAuthenticatorAuthenticationMethod")) {
      throw new Error("Human administrator recovery methods changed unexpectedly");
    }
    return fido;
  };

  const before = await readState();
  const beforeFido = validateBoundary(before);
  fs.writeFileSync(path.join(output, "before.json"), `${JSON.stringify(before, null, 2)}\n`, { mode: 0o600 });
  let changed = false;
  let ambiguousAccepted = false;
  const patch = buildPatch(before.fido);
  if (MODE === "apply" && patch) {
    let response;
    try {
      response = await graph("/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/fido2", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    } catch (error) {
      let accepted = false;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const reconciled = await readState();
        if (validateBoundary(reconciled).complete) { accepted = true; break; }
        await sleep(2500);
      }
      if (!accepted) throw error;
      ambiguousAccepted = true;
    }
    if (response && response.response.status !== 204) throw new Error(`Unexpected PATCH status ${response.response.status}`);
    changed = true;
  }

  let after = before;
  if (MODE === "apply") {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      after = await readState();
      if (validateBoundary(after).complete) break;
      if (attempt === 19) throw new Error("Accepted Windows Hello profile change did not reconcile");
      await sleep(2500);
    }
  }
  const afterFido = validateBoundary(after);
  if (MODE === "apply" && !afterFido.complete) throw new Error("Windows Hello passkey profile is absent after apply");
  if (JSON.stringify(beforeFido.defaultProfile) !== JSON.stringify(afterFido.defaultProfile)) {
    throw new Error("Default passkey profile changed during reconciliation");
  }
  for (const field of ["state", "isSelfServiceRegistrationAllowed", "isAttestationEnforced", "keyRestrictions", "defaultPasskeyProfile", "excludeTargets"]) {
    if (JSON.stringify(before.fido[field]) !== JSON.stringify(after.fido[field])) throw new Error(`FIDO2 ${field} changed unexpectedly`);
  }
  if (JSON.stringify(before.methods) !== JSON.stringify(after.methods)) throw new Error("User authentication methods changed unexpectedly");
  if (JSON.stringify(before.x509) !== JSON.stringify(after.x509)) throw new Error("CBA policy changed unexpectedly");
  if (JSON.stringify(selectedPolicies(before.policies)) !== JSON.stringify(selectedPolicies(after.policies))) {
    throw new Error("Conditional Access policy state changed unexpectedly");
  }
  fs.writeFileSync(path.join(output, "after.json"), `${JSON.stringify(after, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    observedUtc: after.observedUtc,
    mode: MODE,
    changed,
    ambiguousAccepted,
    complete: afterFido.complete,
    fido: {
      state: after.fido.state,
      isSelfServiceRegistrationAllowed: after.fido.isSelfServiceRegistrationAllowed,
      includeTarget: afterFido.allUsers,
      defaultProfile: afterFido.defaultProfile,
      windowsHelloProfile: after.fido.passkeyProfiles.find((profile) => profile.id === WINDOWS_HELLO_PROFILE_ID),
      excludeTargets: after.fido.excludeTargets,
    },
    preserved: {
      securityDefaultsEnabled: after.securityDefaultsEnabled,
      conditionalAccessPolicyCount: selectedPolicies(after.policies).length,
      x509State: after.x509.state,
      userMethodCounts: Object.fromEntries(Object.entries(after.methods).map(([name, methods]) => [name, methods.length])),
      cbaOperatorEnabled: after.operator.accountEnabled,
    },
    protectedOutput: output,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
