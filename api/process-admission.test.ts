import { describe, expect, it } from "vitest";
import {
  API_PROCESS_ADMISSION_LIMITS,
  ProcessLocalApiAdmission,
} from "./process-admission.js";
import { findApiRouteContract } from "../src/api/api-route-contract.js";

describe("process-local API admission", () => {
  it("reserves a bounded control lane for public and undeclared requests", () => {
    const admission = new ProcessLocalApiAdmission();
    const releases = Array.from(
      { length: API_PROCESS_ADMISSION_LIMITS.control },
      () => admission.tryAcquire(undefined),
    );

    expect(releases.every(Boolean)).toBe(true);
    expect(admission.tryAcquire(undefined)).toBeUndefined();
    expect(admission.snapshot()).toEqual({
      control: API_PROCESS_ADMISSION_LIMITS.control,
      operator: 0,
      routeKeys: 0,
    });

    releases[0]!();
    releases[0]!();
    expect(admission.tryAcquire(undefined)).toBeTypeOf("function");
  });

  it.each([
    ["pure", "POST", "/api/scenario-plan", "purePerRoute"],
    ["read-only", "GET", "/api/rehearsal-status", "readOnlyExternalPerRoute"],
    ["mutation", "POST", "/api/calendar-meeting", "boundedMutationPerRoute"],
  ] as const)(
    "applies the %s route ceiling without queueing",
    (_label, method, path, limitKey) => {
      const admission = new ProcessLocalApiAdmission();
      const contract = findApiRouteContract(method, path);
      expect(contract).toBeDefined();
      const limit = API_PROCESS_ADMISSION_LIMITS[limitKey];
      const releases = Array.from(
        { length: limit },
        () => admission.tryAcquire(contract),
      );

      expect(releases.every(Boolean)).toBe(true);
      expect(admission.tryAcquire(contract)).toBeUndefined();
      releases.forEach((release) => release!());
      expect(admission.snapshot()).toEqual({
        control: 0,
        operator: 0,
        routeKeys: 0,
      });
    },
  );

  it("keeps paired mutation methods independently fail-fast", () => {
    const admission = new ProcessLocalApiAdmission();
    const create = findApiRouteContract("POST", "/api/onedrive-share-proof");
    const cleanup = findApiRouteContract("DELETE", "/api/onedrive-share-proof");
    expect(create).toBeDefined();
    expect(cleanup).toBeDefined();

    const release = admission.tryAcquire(create);
    expect(release).toBeTypeOf("function");
    expect(admission.tryAcquire(create)).toBeUndefined();

    const cleanupRelease = admission.tryAcquire(cleanup);
    expect(cleanupRelease).toBeTypeOf("function");
    cleanupRelease!();
    release!();
  });

  it("caps aggregate operator work across otherwise available routes", () => {
    const admission = new ProcessLocalApiAdmission();
    const contracts = [
      findApiRouteContract("POST", "/api/scenario-plan"),
      findApiRouteContract(
        "POST",
        "/api/scenario-evidence-verification",
      ),
      findApiRouteContract("GET", "/api/whoami"),
    ];
    expect(contracts.every(Boolean)).toBe(true);
    const releases = contracts.flatMap((contract) =>
      Array.from(
        { length: API_PROCESS_ADMISSION_LIMITS.purePerRoute },
        () => admission.tryAcquire(contract),
      )
    );
    expect(releases).toHaveLength(API_PROCESS_ADMISSION_LIMITS.operatorTotal);
    expect(releases.every(Boolean)).toBe(true);
    expect(
      admission.tryAcquire(
        findApiRouteContract(
          "POST",
          "/api/private-document-rehearsal-verification",
        ),
      ),
    ).toBeUndefined();

    releases.forEach((release) => release!());
    expect(admission.snapshot().operator).toBe(0);
  });
});
