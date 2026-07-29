import { describe, expect, it } from "vitest";
import config from "../vitest.config.ts";

describe("local test concurrency", () => {
  it("keeps per-worktree Vitest forks within the shared-machine budget", () => {
    expect(config.test?.maxWorkers).toBe("25%");
    expect(config.test?.fileParallelism).not.toBe(false);
    expect(config.test?.testTimeout).toBeUndefined();
    expect(config.test?.hookTimeout).toBeUndefined();
  });
});
