// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  API_DEPLOYMENT_REPLICA_CONTRACT,
  API_SINGLE_REPLICA_SCALE,
  ApiReplicaContractError,
  parseApiDeploymentReplicaPlan,
  requireSingleReplicaScale,
} from "./api-replica-contract.js";

describe("API single-replica contract", () => {
  it("accepts only exact one-to-one scale while ignoring unrelated ARM fields", () => {
    expect(requireSingleReplicaScale({
      minReplicas: 1,
      maxReplicas: 1,
      rules: [],
    })).toBe(API_SINGLE_REPLICA_SCALE);
  });

  it.each([
    undefined,
    null,
    {},
    { minReplicas: 1 },
    { maxReplicas: 1 },
    { minReplicas: 0, maxReplicas: 1 },
    { minReplicas: 1, maxReplicas: 2 },
    { minReplicas: "1", maxReplicas: 1 },
    { minReplicas: 1, maxReplicas: "1" },
  ])("refuses missing, malformed, or drifted scale %#", (value) => {
    expect(() => requireSingleReplicaScale(value)).toThrow(
      ApiReplicaContractError,
    );
  });

  it("accepts only the exact fixed main-API deployment plan", () => {
    expect(parseApiDeploymentReplicaPlan({
      schemaVersion: 1,
      target: "ca-ap2-api",
      minReplicas: 1,
      maxReplicas: 1,
    })).toBe(API_DEPLOYMENT_REPLICA_CONTRACT);
  });

  it.each([
    { schemaVersion: 1, target: "another-app", minReplicas: 1, maxReplicas: 1 },
    { schemaVersion: 2, target: "ca-ap2-api", minReplicas: 1, maxReplicas: 1 },
    { schemaVersion: 1, target: "ca-ap2-api", minReplicas: 1, maxReplicas: 2 },
    { schemaVersion: 1, target: "ca-ap2-api", minReplicas: 1, maxReplicas: 1, ready: true },
  ])("refuses mismatched or expanded deployment plan %#", (value) => {
    expect(() => parseApiDeploymentReplicaPlan(value)).toThrow(
      ApiReplicaContractError,
    );
  });
});
