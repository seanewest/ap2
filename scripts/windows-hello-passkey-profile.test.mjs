import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_ID,
  WINDOWS_HELLO_AAGUIDS,
  WINDOWS_HELLO_PROFILE,
  WINDOWS_HELLO_PROFILE_ID,
  assertPreflightFido,
  buildPatch,
} from "./windows-hello-passkey-profile.mjs";

function preflight() {
  return {
    state: "enabled",
    isSelfServiceRegistrationAllowed: true,
    isAttestationEnforced: false,
    keyRestrictions: { isEnforced: false, enforcementType: "block", aaGuids: [] },
    defaultPasskeyProfile: DEFAULT_PROFILE_ID,
    includeTargets: [{ targetType: "group", id: "all_users", isRegistrationRequired: false, allowedPasskeyProfiles: [DEFAULT_PROFILE_ID] }],
    excludeTargets: [],
    passkeyProfiles: [{
      id: DEFAULT_PROFILE_ID,
      name: "Default passkey profile",
      passkeyTypes: "deviceBound,synced",
      attestationEnforcement: "disabled",
      keyRestrictions: { isEnforced: false, enforcementType: "block", aaGuids: [] },
    }],
  };
}

describe("Windows Hello passkey profile reconciliation", () => {
  it("adds only the exact supported profile and all_users assignment", () => {
    const patch = buildPatch(preflight());
    expect(patch).toEqual({
      "@odata.type": "#microsoft.graph.fido2AuthenticationMethodConfiguration",
      passkeyProfiles: [preflight().passkeyProfiles[0], WINDOWS_HELLO_PROFILE],
      includeTargets: [{
        ...preflight().includeTargets[0],
        allowedPasskeyProfiles: [DEFAULT_PROFILE_ID, WINDOWS_HELLO_PROFILE_ID],
      }],
    });
    expect(WINDOWS_HELLO_AAGUIDS).toEqual([
      "08987058-cadc-4b81-b6e1-30de50dcbe96",
      "9ddd1817-af5a-4672-a2b9-3e3dd95000a9",
      "6028b017-b1d4-4c02-b4b3-afcdafc96bb2",
    ]);
  });

  it("is idempotent and rejects Default profile drift", () => {
    const current = preflight();
    current.passkeyProfiles.push(structuredClone(WINDOWS_HELLO_PROFILE));
    current.includeTargets[0].allowedPasskeyProfiles.push(WINDOWS_HELLO_PROFILE_ID);
    expect(assertPreflightFido(current).complete).toBe(true);
    expect(buildPatch(current)).toBeNull();

    const drifted = preflight();
    drifted.passkeyProfiles[0].passkeyTypes = "deviceBound";
    expect(() => buildPatch(drifted)).toThrow("Default passkey profile changed unexpectedly");
  });
});
