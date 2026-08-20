import { installation } from "../installation/server.ts";

export const API_SINGLE_REPLICA_SCALE = Object.freeze({
  minReplicas: 1,
  maxReplicas: 1,
} as const);

export const API_DEPLOYMENT_REPLICA_CONTRACT = Object.freeze({
  schemaVersion: 1,
  target: installation.azure.apiContainerApp,
  ...API_SINGLE_REPLICA_SCALE,
} as const);

export class ApiReplicaContractError extends Error {
  constructor() {
    super("The API replica topology is not the required single-replica shape.");
    this.name = "ApiReplicaContractError";
  }
}

export function requireSingleReplicaScale(
  value: unknown,
): typeof API_SINGLE_REPLICA_SCALE {
  if (
    !isRecord(value) ||
    value.minReplicas !== API_SINGLE_REPLICA_SCALE.minReplicas ||
    value.maxReplicas !== API_SINGLE_REPLICA_SCALE.maxReplicas
  ) {
    throw new ApiReplicaContractError();
  }
  return API_SINGLE_REPLICA_SCALE;
}

export function parseApiDeploymentReplicaPlan(
  value: unknown,
): typeof API_DEPLOYMENT_REPLICA_CONTRACT {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !==
      "maxReplicas,minReplicas,schemaVersion,target" ||
    value.schemaVersion !== API_DEPLOYMENT_REPLICA_CONTRACT.schemaVersion ||
    value.target !== API_DEPLOYMENT_REPLICA_CONTRACT.target
  ) {
    throw new ApiReplicaContractError();
  }
  requireSingleReplicaScale(value);
  return API_DEPLOYMENT_REPLICA_CONTRACT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
