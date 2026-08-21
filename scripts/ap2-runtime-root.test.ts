import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ap2RuntimePath,
  resolveAp2RuntimeRoot,
} from "./ap2-runtime-root.mjs";

describe("AP2 development runtime location", () => {
  it("prefers an explicit runtime root", () => {
    expect(resolveAp2RuntimeRoot({
      AP2_RUNTIME_ROOT: "/vault/ap2-development",
      HOME: "/home/agent",
    })).toBe("/vault/ap2-development");
  });

  it("uses the conventional agent-owned data location by default", () => {
    expect(resolveAp2RuntimeRoot({ HOME: "/home/agent" })).toBe(
      "/home/agent/.local/share/ap2/runtime",
    );
    expect(resolveAp2RuntimeRoot({
      HOME: "/ignored",
      XDG_DATA_HOME: "/durable/data",
    })).toBe("/durable/data/ap2/runtime");
  });

  it("refuses relative roots and paths that escape the runtime", () => {
    expect(() => resolveAp2RuntimeRoot({
      AP2_RUNTIME_ROOT: "relative/runtime",
    })).toThrow("AP2_RUNTIME_ROOT must be absolute");
    expect(() => ap2RuntimePath("../outside", {
      AP2_RUNTIME_ROOT: "/home/agent/.local/share/ap2/runtime",
    })).toThrow("stay inside");
  });

  it("keeps executable tooling independent of the retired runtime tree", () => {
    for (const relativePath of [
      "scripts/check-ap2-durable-runtime.mjs",
      "scripts/guest-clickfix-proof.mjs",
      "scripts/rachel-enrollment-session-proof.mjs",
      "scripts/run-ap2-durable-readiness.sh",
    ]) {
      expect(readFileSync(resolve(relativePath), "utf8")).not.toContain(
        "/var/lib/codex-agent-tools-replacement",
      );
    }
  });
});
