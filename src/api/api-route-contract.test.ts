import { describe, expect, it } from "vitest";
import {
  API_ROUTE_CONTRACTS,
  API_ROUTE_OWNER_KEYS,
  apiRouteContract,
  findApiRouteContract,
  inventoryApiRouteContracts,
  type ApiRouteContract,
  type ApiRouteContractFailure,
} from "./api-route-contract.ts";
import { OPERATION_TELEMETRY_MAX_RESPONSE_BYTES } from "../../api/operation-telemetry-collector.ts";

describe("authoritative API route contracts", () => {
  it("covers every fixed owner and method/path exactly once", () => {
    const inventory = inventoryApiRouteContracts();
    expect(inventory.status).toBe("valid");
    expect(inventory.failures).toEqual([]);
    expect(inventory.routes).toHaveLength(API_ROUTE_OWNER_KEYS.length);
    expect(new Set(inventory.routes.map(({ ownerKey }) => ownerKey)).size)
      .toBe(API_ROUTE_OWNER_KEYS.length);
    expect(
      new Set(inventory.routes.map(({ method, path }) => `${method} ${path}`))
        .size,
    ).toBe(API_ROUTE_OWNER_KEYS.length);
    for (const contract of inventory.routes) {
      expect(findApiRouteContract(contract.method, contract.path)).toEqual(
        contract,
      );
      expect(apiRouteContract(contract.ownerKey)).toEqual(contract);
    }
  });

  it("binds the operation-event response limit to its collector", () => {
    expect(bounds("operation-events")).toEqual([
      0,
      OPERATION_TELEMETRY_MAX_RESPONSE_BYTES,
    ]);
  });

  it("contains only fixed sanitized metadata", () => {
    const serialized = JSON.stringify(inventoryApiRouteContracts());
    expect(serialized).not.toMatch(
      /(?:tenant|subscription|credential|token|payload|proofReference|marker|@|\\\\|\/home\/)/i,
    );
  });

  it.each([
    ["AUTH_BODY_POLICY", (route) => ({ ...route, authBeforeBody: false })],
    ["BOUNDS_INVALID", (route) => ({ ...route, responseMaxBytes: 0 })],
    ["EXTERNAL_POLICY", (route) => ({
      ...route,
      sideEffect: "read-only-external",
      externalCall: false,
    })],
    ["INPUT_SHAPE", (route) => ({ ...route, unexpected: true })],
    ["MUTATION_RETRY", (route) => ({
      ...route,
      sideEffect: "bounded-mutation",
      externalCall: true,
      persistence: true,
      retry: true,
    })],
    ["PERSISTENCE_POLICY", (route) => ({
      ...route,
      sideEffect: "read-only-external",
      externalCall: true,
      persistence: true,
    })],
    ["PURE_SIDE_EFFECT", (route) => ({ ...route, externalCall: true })],
    ["SCHEDULING_POLICY", (route) => ({ ...route, scheduling: true })],
  ] satisfies readonly [
    ApiRouteContractFailure,
    (route: ApiRouteContract) => unknown,
  ][])("fails closed for %s drift", (category, mutate) => {
    const candidates: unknown[] = [...API_ROUTE_CONTRACTS];
    candidates[1] = mutate(API_ROUTE_CONTRACTS[1]);
    expect(failureCategories(candidates)).toContain(category);
  });

  it("rejects duplicate, missing, and unsafe mutation declarations", () => {
    const duplicatePath: unknown[] = [...API_ROUTE_CONTRACTS];
    duplicatePath[1] = {
      ...API_ROUTE_CONTRACTS[1],
      method: API_ROUTE_CONTRACTS[0].method,
      path: API_ROUTE_CONTRACTS[0].path,
    };
    expect(failureCategories(duplicatePath)).toContain("DUPLICATE_METHOD_PATH");

    const duplicateOwner: unknown[] = [...API_ROUTE_CONTRACTS];
    duplicateOwner[1] = {
      ...API_ROUTE_CONTRACTS[1],
      ownerKey: API_ROUTE_CONTRACTS[0].ownerKey,
    };
    expect(failureCategories(duplicateOwner)).toContain("DUPLICATE_OWNER");

    expect(failureCategories(API_ROUTE_CONTRACTS.slice(1))).toContain(
      "OWNER_COVERAGE",
    );

    const mutation: ApiRouteContract[] = [...API_ROUTE_CONTRACTS];
    const index = mutation.findIndex(
      ({ sideEffect }) => sideEffect === "bounded-mutation",
    );
    mutation[index] = {
      ...mutation[index]!,
      externalCall: false,
      persistence: false,
    };
    expect(failureCategories(mutation)).toEqual(
      expect.arrayContaining(["EXTERNAL_POLICY", "PERSISTENCE_POLICY"]),
    );
  });
});

function failureCategories(
  candidates: readonly unknown[],
): ApiRouteContractFailure[] {
  return inventoryApiRouteContracts(candidates).failures.map(
    ({ category }) => category,
  );
}

function bounds(
  ownerKey: Parameters<typeof apiRouteContract>[0],
): readonly [number, number] {
  const contract = apiRouteContract(ownerKey);
  return [contract.requestMaxBytes, contract.responseMaxBytes];
}
