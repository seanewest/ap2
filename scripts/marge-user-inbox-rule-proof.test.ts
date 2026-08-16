import { describe, expect, it } from "vitest";
import {
  assertActiveMargeSession,
  isExactEffectMessage,
  isExactRuleShape,
  proofMarker,
  ruleRequest,
} from "./marge-user-inbox-rule-proof.ts";

const marker = proofMarker("AP2-MARGE-USER-RULE-20260815T1347Z");

describe("recovered W53 Marge inbox-rule method", () => {
  it("freezes the unique marker and sole rule condition/action", () => {
    expect(ruleRequest(marker, 4)).toEqual({
      displayName: "AP2 Marge user rule AP2-MARGE-USER-RULE-20260815T1347Z",
      sequence: 4,
      isEnabled: true,
      conditions: {
        subjectContains: [
          "AP2 harmless Marge rule marker AP2-MARGE-USER-RULE-20260815T1347Z",
        ],
      },
      actions: { markAsRead: true, stopProcessingRules: false },
    });
    expect(isExactRuleShape({
      ...ruleRequest(marker, 4),
      isReadOnly: false,
      hasError: false,
      exceptions: {},
    }, marker)).toBe(true);
    expect(isExactRuleShape({
      ...ruleRequest(marker, 4),
      actions: { markAsRead: true, stopProcessingRules: true },
    }, marker)).toBe(false);
    expect(isExactRuleShape({
      ...ruleRequest(marker, 4),
      conditions: { subjectContains: [marker.subject], fromAddresses: ["extra"] },
    }, marker)).toBe(false);
  });

  it("accepts only the exact one-message read effect", () => {
    const exact = {
      subject: marker.subject,
      isRead: true,
      hasAttachments: false,
      sender: {
        emailAddress: { address: "homer.simpson@corywest.onmicrosoft.com" },
      },
      toRecipients: [{
        emailAddress: { address: "marge.simpson@corywest.onmicrosoft.com" },
      }],
    };
    expect(isExactEffectMessage(exact, marker)).toBe(true);
    expect(isExactEffectMessage({ ...exact, isRead: false }, marker)).toBe(false);
    expect(isExactEffectMessage({ ...exact, hasAttachments: true }, marker)).toBe(false);
  });

  it("requires the exact active Marge AVD session", () => {
    const state = {
      observedUtc: "2026-08-15T14:09:00Z",
      powerState: "PowerState/running",
      sessionHostStatus: "Available",
      declaredSessionCount: 1,
      userSessions: [{
        id: "/exact/session/2",
        userPrincipalName: "marge.simpson@corywest.onmicrosoft.com",
        sessionState: "Active",
      }],
    };
    expect(() => assertActiveMargeSession(state)).not.toThrow();
    expect(() => assertActiveMargeSession({
      ...state,
      userSessions: [{ ...state.userSessions[0]!, sessionState: "Disconnected" }],
    })).toThrow(/exact active AVD session/);
  });

  it("rejects non-unique run markers", () => {
    expect(() => proofMarker("AP2-MARGE-USER-RULE-fixed")).toThrow(/AP2_RUN_ID/);
  });
});
