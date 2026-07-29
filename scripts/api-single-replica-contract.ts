import { readFileSync, realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  API_DEPLOYMENT_REPLICA_CONTRACT,
  parseApiDeploymentReplicaPlan,
} from "../api/api-replica-contract.ts";

const MAX_PLAN_BYTES = 4_096;

export function checkApiDeploymentReplicaPlan(value: unknown): Readonly<{
  schemaVersion: 1;
  label: "API_SINGLE_REPLICA_CONTRACT";
  status: "valid";
  target: typeof API_DEPLOYMENT_REPLICA_CONTRACT.target;
  minReplicas: 1;
  maxReplicas: 1;
}> {
  const plan = parseApiDeploymentReplicaPlan(value);
  return Object.freeze({
    schemaVersion: 1,
    label: "API_SINGLE_REPLICA_CONTRACT",
    status: "valid",
    target: plan.target,
    minReplicas: plan.minReplicas,
    maxReplicas: plan.maxReplicas,
  });
}

function main(): void {
  if (process.argv.length !== 3) {
    throw new Error("API replica plan refused.");
  }
  const path = realpathSync(process.argv[2]!);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PLAN_BYTES) {
    throw new Error("API replica plan refused.");
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("API replica plan refused.");
  }
  console.log(JSON.stringify(checkApiDeploymentReplicaPlan(value)));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    main();
  } catch {
    console.error("API replica plan refused.");
    process.exitCode = 1;
  }
}
