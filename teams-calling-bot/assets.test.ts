// @vitest-environment node

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildTeamsCallingBotPackage } from "../scripts/package-teams-calling-bot-app.js";

const manifest = JSON.parse(readFileSync(
  new URL("./teams-app/manifest.template.json", import.meta.url),
  "utf8",
)) as Record<string, unknown>;
const bicep = readFileSync(
  new URL("./deploy/main.bicep", import.meta.url),
  "utf8",
);
const dockerfile = readFileSync(
  new URL("./Dockerfile", import.meta.url),
  "utf8",
);

describe("calling-bot deployment assets", () => {
  it("keeps the Teams app personal, audio-only, and free of extra capabilities", () => {
    expect(manifest.id).toBe("{{APP_ID}}");
    expect(manifest).not.toHaveProperty("permissions");
    expect(manifest).not.toHaveProperty("authorization");
    expect(manifest).not.toHaveProperty("staticTabs");
    expect(manifest).not.toHaveProperty("composeExtensions");
    expect(manifest).not.toHaveProperty("connectors");
    expect(manifest.bots).toEqual([{
      botId: "{{APP_ID}}",
      scopes: ["personal"],
      supportsFiles: false,
      isNotificationOnly: true,
      supportsCalling: true,
      supportsVideo: false,
    }]);
  });

  it("keeps deployment single-replica, rootless, and runtime-parameterized", () => {
    expect(bicep).toContain("minReplicas: 1");
    expect(bicep).toContain("maxReplicas: 1");
    expect(bicep).toContain("callingWebhook: callbackUri");
    expect(bicep).toContain("storageType: 'AzureFile'");
    expect(bicep).toContain("storageType: 'Secret'");
    expect(bicep).not.toContain("Calls.Initiate.All");
    expect(bicep).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    expect(dockerfile).toContain("USER node");
  });

  it("renders both run-canary parameter values as lowercase strings", () => {
    const conditional = bicep.match(
      /name: 'TEAMS_CALLING_BOT_RUN_CANARY'\s+value: runCanary \? '([^']+)' : '([^']+)'/,
    );
    expect(conditional).not.toBeNull();
    const render = (runCanary: boolean): string =>
      runCanary ? conditional![1]! : conditional![2]!;
    expect(render(true)).toBe("true");
    expect(render(false)).toBe("false");
    expect(bicep).not.toContain("string(runCanary)");
  });

  it("packages identical normalized bytes on repeated builds", () => {
    const first = buildTeamsCallingBotPackage(
      "11111111-1111-4111-8111-111111111111",
      "calling.example.test",
    );
    const second = buildTeamsCallingBotPackage(
      "11111111-1111-4111-8111-111111111111",
      "calling.example.test",
    );
    expect(sha256(first)).toBe(sha256(second));
    expect(first.equals(second)).toBe(true);
  });
});

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
