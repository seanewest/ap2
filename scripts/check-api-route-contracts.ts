import {
  API_ROUTE_CONTRACTS,
  inventoryApiRouteContracts,
} from "../src/api/api-route-contract.ts";

if (process.argv.length !== 2) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    label: "API_ROUTE_CONTRACT_INVENTORY",
    status: "invalid",
    routes: [],
    failures: [{ ownerKey: "inventory", category: "INPUT_SHAPE" }],
  })}\n`);
  process.exitCode = 2;
} else {
  const inventory = inventoryApiRouteContracts();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: inventory.schemaVersion,
    label: inventory.label,
    status: inventory.status,
    routes: inventory.routes.map((contract) => ({
      method: contract.method,
      path: contract.path,
      authorization: contract.authorization,
      authBeforeBody: contract.authBeforeBody,
      requestMaxBytes: contract.requestMaxBytes,
      responseMaxBytes: contract.responseMaxBytes,
      errorMaxBytes: contract.errorMaxBytes,
      sideEffect: contract.sideEffect,
      externalCall: contract.externalCall,
      persistence: contract.persistence,
      retry: contract.retry,
      scheduling: contract.scheduling,
      ownerKey: contract.ownerKey,
    })),
    failures: inventory.failures,
  })}\n`);

  if (
    inventory.status !== "valid" ||
    inventory.routes.length !== API_ROUTE_CONTRACTS.length
  ) {
    process.exitCode = 1;
  }
}
