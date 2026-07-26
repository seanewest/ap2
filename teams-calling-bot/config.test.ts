// @vitest-environment node

import { describe, expect, it } from "vitest";
import { loadCallingBotConfig } from "./config.js";

const environment = {
  TEAMS_CALLING_BOT_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  TEAMS_CALLING_BOT_APP_ID: "22222222-2222-4222-8222-222222222222",
  TEAMS_CALLING_BOT_TARGET_USER_ID: "33333333-3333-4333-8333-333333333333",
  TEAMS_CALLING_BOT_CALLBACK_URI:
    "https://calling.example.test/callbacks/calls",
  TEAMS_CALLING_BOT_CERTIFICATE_PATH: "/run/secrets/certificate.pem",
  TEAMS_CALLING_BOT_JOURNAL_PATH: "/journal/call.jsonl",
  TEAMS_CALLING_BOT_RUN_MARKER: "ap2-call-fixture",
};

describe("loadCallingBotConfig", () => {
  it("keeps the startup canary disabled unless exactly enabled", () => {
    expect(loadCallingBotConfig(environment).runCanary).toBe(false);
    expect(loadCallingBotConfig({
      ...environment,
      TEAMS_CALLING_BOT_RUN_CANARY: "true",
    }).runCanary).toBe(true);
    expect(() => loadCallingBotConfig({
      ...environment,
      TEAMS_CALLING_BOT_RUN_CANARY: "yes",
    })).toThrow("TEAMS_CALLING_BOT_RUN_CANARY must be true or false");
  });

  it("requires exact runtime identity and callback inputs", () => {
    expect(() => loadCallingBotConfig({
      ...environment,
      TEAMS_CALLING_BOT_APP_ID: "not-an-id",
    })).toThrow("TEAMS_CALLING_BOT_APP_ID must be a UUID");
    expect(() => loadCallingBotConfig({
      ...environment,
      TEAMS_CALLING_BOT_CALLBACK_URI: "https://calling.example.test/other",
    })).toThrow("must be an exact HTTPS /callbacks/calls URL");
  });
});
