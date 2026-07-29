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
import {
  SCENARIO_PLAN_MAX_REQUEST_BYTES,
  SCENARIO_PLAN_MAX_RESPONSE_BYTES,
} from "../../api/scenario-plan.ts";
import {
  SCENARIO_RECEIPT_MAX_REQUEST_BYTES,
  SCENARIO_RECEIPT_MAX_RESPONSE_BYTES,
} from "../../api/scenario-evidence-verification.ts";
import { OPERATION_TELEMETRY_MAX_RESPONSE_BYTES } from "../../api/operation-telemetry-collector.ts";
import {
  REHEARSAL_OUTPUT_MAX_REQUEST_BYTES,
  REHEARSAL_OUTPUT_MAX_RESPONSE_BYTES,
} from "./rehearsal-output-verification-contract.ts";
import {
  PRIVATE_DOCUMENT_REHEARSAL_MAX_REQUEST_BYTES,
  PRIVATE_DOCUMENT_REHEARSAL_MAX_RESPONSE_BYTES,
} from "./private-document-rehearsal-verification-contract.ts";
import {
  BATCH_FEASIBILITY_MAX_REQUEST_BYTES,
  BATCH_FEASIBILITY_MAX_RESPONSE_BYTES,
} from "./multi-scenario-feasibility-contract.ts";
import {
  HELP_DESK_EMAIL_REHEARSAL_MAX_REQUEST_BYTES,
  HELP_DESK_EMAIL_REHEARSAL_MAX_RESPONSE_BYTES,
} from "./help-desk-email-rehearsal-verification-contract.ts";

const EXPECTED_PURE_OWNERS = [
  "scenario-plan-compile",
  "scenario-receipt-verify",
  "avd-rehearsal-verify",
  "private-document-rehearsal-verify",
  "help-desk-email-rehearsal-verify",
  "batch-feasibility-calculate",
] as const;

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

  it("classifies every planning and verification route as pure", () => {
    expect(
      EXPECTED_PURE_OWNERS.map((ownerKey) => apiRouteContract(ownerKey)),
    ).toEqual(
      expect.arrayContaining(
        EXPECTED_PURE_OWNERS.map((ownerKey) =>
          expect.objectContaining({
            ownerKey,
            authorization: "operator",
            authBeforeBody: true,
            sideEffect: "pure",
            externalCall: false,
            persistence: false,
            retry: false,
            scheduling: false,
          })
        ),
      ),
    );
  });

  it("binds server and client byte limits to the existing safe contracts", () => {
    expect(bounds("operation-events")).toEqual([
      0,
      OPERATION_TELEMETRY_MAX_RESPONSE_BYTES,
    ]);
    expect(bounds("scenario-plan-compile")).toEqual([
      SCENARIO_PLAN_MAX_REQUEST_BYTES,
      SCENARIO_PLAN_MAX_RESPONSE_BYTES,
    ]);
    expect(bounds("scenario-receipt-verify")).toEqual([
      SCENARIO_RECEIPT_MAX_REQUEST_BYTES,
      SCENARIO_RECEIPT_MAX_RESPONSE_BYTES,
    ]);
    expect(bounds("avd-rehearsal-verify")).toEqual([
      REHEARSAL_OUTPUT_MAX_REQUEST_BYTES,
      REHEARSAL_OUTPUT_MAX_RESPONSE_BYTES,
    ]);
    expect(bounds("private-document-rehearsal-verify")).toEqual([
      PRIVATE_DOCUMENT_REHEARSAL_MAX_REQUEST_BYTES,
      PRIVATE_DOCUMENT_REHEARSAL_MAX_RESPONSE_BYTES,
    ]);
    expect(bounds("help-desk-email-rehearsal-verify")).toEqual([
      HELP_DESK_EMAIL_REHEARSAL_MAX_REQUEST_BYTES,
      HELP_DESK_EMAIL_REHEARSAL_MAX_RESPONSE_BYTES,
    ]);
    expect(bounds("batch-feasibility-calculate")).toEqual([
      BATCH_FEASIBILITY_MAX_REQUEST_BYTES,
      BATCH_FEASIBILITY_MAX_RESPONSE_BYTES,
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
