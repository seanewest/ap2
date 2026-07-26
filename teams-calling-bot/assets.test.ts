// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
});
