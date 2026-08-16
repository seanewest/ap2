import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUN_VALUE_DATA as systemRunData,
  systemCleanup,
  systemInspect,
  systemStage,
} from "./endpoint-background-system.mjs";
import {
  RUN_VALUE_DATA as kobeRunData,
  cleanupScript,
  recoveryInspectScript,
  stageScript,
  userPayload,
} from "./endpoint-background-kobe.mjs";

const SYSTEM_RUN = "AP2-ENDPOINT-BG-20260815T1004Z";
const KOBE_RUN = "AP2-KOBE-USER-BG-20260815T1105Z";

describe("recovered endpoint-background methods", () => {
  it("keeps the W45 SYSTEM/Run Command method bounded and reversible", () => {
    const stage = systemStage(SYSTEM_RUN);
    const inspect = systemInspect(SYSTEM_RUN);
    const cleanup = systemCleanup(SYSTEM_RUN);

    expect(systemRunData).toBe("cmd.exe /d /c exit 0");
    expect(stage).toContain("ExecutionPolicy','Bypass");
    expect(stage).toContain("harmless-compromise-marker.txt");
    expect(stage).toContain("HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    expect(stage).toContain("triggered=$false");
    expect(inspect).toContain("'nt authority\\system'");
    expect(inspect).toContain("processSessionId -ne 0");
    expect(cleanup).toContain("Refusing to remove a non-canary Run value");
    expect(cleanup).toContain("Cleanup verification failed");
  });

  it("keeps the W49/W51 Kobe method interactive and non-replayable", () => {
    const payload = userPayload(KOBE_RUN);
    const stage = stageScript(KOBE_RUN);
    const inspect = recoveryInspectScript(KOBE_RUN, "AzureAD\\KobeWest");
    const cleanup = cleanupScript(KOBE_RUN, "AzureAD\\KobeWest");
    const source = fs.readFileSync(
      path.join(process.cwd(), "scripts/endpoint-background-kobe.mjs"),
      "utf8",
    );

    expect(kobeRunData).toBe("cmd.exe /d /c exit 0");
    expect(payload).toContain("$env:LOCALAPPDATA");
    expect(payload).toContain("authenticationType=$identity.AuthenticationType");
    expect(payload).toContain("processSessionId=$self.SessionId");
    expect(payload).toContain("triggered=$false");
    expect(stage).toContain("inspect rather than replay");
    expect(inspect).toContain("Get-ChildItem -LiteralPath 'C:\\Users'");
    expect(inspect).toContain("Ambiguous recovered profile roots");
    expect(inspect).toContain("CloudAP");
    expect(inspect).toContain("Medium");
    expect(cleanup).toContain("Refusing ambiguous cleanup");
    expect(cleanup).toContain("Refusing to remove a non-canary Run value");
    expect(source).toContain("The launch is never repeated for this run ID");
    expect(source).toContain("Refusing ambiguous session cleanup/deallocation");
    expect(source).toContain('final.power!=="PowerState/deallocated"');
  });

  it("does not collapse SYSTEM and interactive-user execution", () => {
    expect(systemStage(SYSTEM_RUN)).toContain("$env:ProgramData");
    expect(userPayload(KOBE_RUN)).toContain("$env:LOCALAPPDATA");
    expect(systemInspect(SYSTEM_RUN)).toContain("nt authority\\system");
    expect(recoveryInspectScript(KOBE_RUN, "AzureAD\\KobeWest")).toContain(
      "AzureAD\\KobeWest",
    );
  });
});
