import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");
const words = (text: string): number => text.trim().split(/\s+/).length;

describe("documentation authority boundaries", () => {
  it("keeps repository AGENTS guidance compact", () => {
    const guidance = read("AGENTS.md");
    expect(words(guidance)).toBeLessThanOrEqual(900);
    expect(guidance).toContain("Generic Strategist, Coordinator, and");
    expect(guidance).toMatch(/When guidance\s+changes, revise the canonical source/);
  });

  it("keeps normal AP2 Coordinator orientation bounded", () => {
    const orientation = `${read("AGENTS.md")}\n${read("coordinator-strategy.md")}`;
    expect(words(orientation)).toBeLessThanOrEqual(1_100);
    expect(orientation).toContain("do not ingest that full ledger");
    expect(orientation).toContain("not normal Coordinator\norientation");
  });

  it("reserves the strategy snapshot for Strategist handoff", () => {
    const snapshot = read("STRATEGY-SNAPSHOT.md");
    expect(words(snapshot)).toBeLessThanOrEqual(1_200);
    expect(snapshot).toContain("point-in-time handoff for a fresh AP2 Strategist");
    expect(snapshot).toMatch(/not live[\s\S]*or normal\s+Coordinator\/worker orientation/);
    expect(snapshot).toMatch(/does not become\s+part of routine Coordinator orientation/);
  });

  it("treats proven capabilities as searchable evidence rather than orientation", () => {
    const evidence = read("docs/proven-capabilities.md");
    expect(evidence).toContain("searchable evidence ledger, not cover-to-cover orientation");
    expect(evidence).toContain("completed evidence, not an implied backlog");
  });
});
