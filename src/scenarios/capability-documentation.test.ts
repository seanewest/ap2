// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENARIO_MANIFESTS } from "./scenarios.ts";

const ledger = readFileSync("docs/proven-capabilities.md", "utf8");
const current = readFileSync("CURRENT.md", "utf8");

describe("canonical capability documentation", () => {
  it("lists every canonical scenario exactly once in the source-backed table", () => {
    const sourceBacked = section(
      ledger,
      "## Source-backed capability building blocks",
      "The remaining entries below are historical evidence narratives",
    );
    const documented = tableTitles(sourceBacked);
    const canonical = SCENARIO_MANIFESTS.map(({ title }) => title);

    expect([...documented].sort()).toEqual([...canonical].sort());
    expect(new Set(documented).size).toBe(documented.length);
  });

  it("does not describe a migrated scenario family as a historical non-manifest", () => {
    const historical = section(
      ledger,
      "The remaining entries below are historical evidence narratives",
      "## Identity and infrastructure proofs",
    );
    const historicalTitles = tableTitles(historical);

    for (const manifest of SCENARIO_MANIFESTS) {
      const family = semanticTokens(manifest.id);
      expect(
        historicalTitles.some((title) => {
          const titleTokens = new Set(semanticTokens(title));
          return family.every((token) => titleTokens.has(token));
        }),
        `${manifest.id} is duplicated in the historical non-manifest table`,
      ).toBe(false);
    }
  });

  it("keeps completed AVD learner proof out of the future-work docket", () => {
    const future = section(
      current,
      "## Future endpoint automation",
      "## API durability decision",
    );
    const closed = section(current, "## Closed/do not reopen", "");

    expect(future).not.toContain("AVD personal prototype");
    expect(closed).toContain(
      "The AVD personal-host learner lane is live-proven and closed.",
    );
    expect(closed).toContain(
      "canonical private three-VM substrate",
    );
    expect(closed).toContain("did not include a learner session");
  });
});

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = end.length === 0
    ? source.length
    : source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function tableTitles(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => line.startsWith("| "))
    .map((line) => line.split("|")[1]?.trim() ?? "")
    .filter((title) =>
      title !== "Scenario" &&
      title !== "Capability building block" &&
      !/^-+$/.test(title)
    );
}

function semanticTokens(value: string): string[] {
  const generic = new Set(["evidence", "oauth", "observation", "substrate"]);
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !generic.has(token));
}
