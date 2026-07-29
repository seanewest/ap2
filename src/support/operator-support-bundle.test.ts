import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OPERATOR_SUPPORT_BUNDLE_MAX_BYTES,
  OPERATOR_SUPPORT_BUNDLE_MAX_FAILURES,
  createOperatorSupportBundleSession,
  serializeOperatorSupportBundle,
  REHEARSAL_SUPPORT_ROUTE_CATEGORIES,
} from "./operator-support-bundle";
import { API_ROUTE_CONTRACTS } from "../api/api-route-contract";

describe("operator support bundle", () => {
  it("binds only the six pure rehearsal-verification route owners", () => {
    expect(REHEARSAL_SUPPORT_ROUTE_CATEGORIES).toHaveLength(6);
    for (const ownerKey of REHEARSAL_SUPPORT_ROUTE_CATEGORIES) {
      expect(API_ROUTE_CONTRACTS.find((route) =>
        route.ownerKey === ownerKey
      )).toEqual(expect.objectContaining({
        authorization: "operator",
        sideEffect: "pure",
        externalCall: false,
        persistence: false,
        retry: false,
        scheduling: false,
      }));
    }
  });

  it("accepts every fixed route category through the runtime boundary", () => {
    const session = createOperatorSupportBundleSession(
      () => new Date("2026-07-29T12:00:00.000Z"),
    );
    for (const routeCategory of REHEARSAL_SUPPORT_ROUTE_CATEGORIES) {
      session.recordFailure({
        routeCategory,
        categoricalStatus: "unavailable",
        error: supportReferencedError("r1_0123456789abcdef01234567"),
      });
    }
    expect(
      session.createBundle()?.failures.map(({ routeCategory }) =>
        routeCategory
      ),
    ).toEqual(REHEARSAL_SUPPORT_ROUTE_CATEGORIES);
  });

  it("keeps the fixed safe application version aligned with the package", () => {
    const packageMetadata = JSON.parse(
      readFileSync("package.json", "utf8"),
    ) as { version?: unknown };
    const session = createOperatorSupportBundleSession(
      () => new Date("2026-07-29T12:00:00.000Z"),
    );
    session.recordFailure({
      routeCategory: "avd-rehearsal-verify",
      categoricalStatus: "unavailable",
      error: supportReferencedError("r1_0123456789abcdef01234567"),
    });
    expect(session.createBundle()?.applicationVersion).toBe(
      packageMetadata.version,
    );
  });

  it("emits a deterministic allowlisted bundle from valid in-memory failures", () => {
    const timestamps = [
      new Date("2026-07-29T12:00:00.000Z"),
      new Date("2026-07-29T12:01:00.000Z"),
      new Date("2026-07-29T12:02:00.000Z"),
    ];
    const session = createOperatorSupportBundleSession(
      () => timestamps.shift()!,
    );
    session.recordFailure({
      routeCategory: "avd-rehearsal-verify",
      categoricalStatus: "verification-refused",
      error: supportReferencedError("r1_0123456789abcdef01234567"),
    });
    session.recordFailure({
      routeCategory: "help-desk-email-rehearsal-verify",
      categoricalStatus: "server-shutting-down",
      error: supportReferencedError("r1_89abcdef0123456789abcdef"),
    });

    const bundle = session.createBundle();
    expect(bundle).toEqual({
      schemaVersion: 1,
      label: "AP2_OPERATOR_SUPPORT_BUNDLE",
      applicationVersion: "0.1.0",
      buildCategory: "browser-spa",
      exportedAt: "2026-07-29T12:02:00.000Z",
      failures: [
        {
          occurredAt: "2026-07-29T12:00:00.000Z",
          routeCategory: "avd-rehearsal-verify",
          categoricalStatus: "verification-refused",
          supportReference: "r1_0123456789abcdef01234567",
        },
        {
          occurredAt: "2026-07-29T12:01:00.000Z",
          routeCategory: "help-desk-email-rehearsal-verify",
          categoricalStatus: "server-shutting-down",
          supportReference: "r1_89abcdef0123456789abcdef",
        },
      ],
    });
    expect(serializeOperatorSupportBundle(bundle!)).toBe(
      `${JSON.stringify(bundle, null, 2)}\n`,
    );
  });

  it("ignores malformed references, hostile getters, and invalid timestamps", () => {
    const invalidClock = createOperatorSupportBundleSession(
      () => new Date(Number.NaN),
    );
    invalidClock.recordFailure({
      routeCategory: "avd-rehearsal-verify",
      categoricalStatus: "unavailable",
      error: supportReferencedError("r1_0123456789abcdef01234567"),
    });
    expect(invalidClock.createBundle()).toBeUndefined();

    const session = createOperatorSupportBundleSession(
      () => new Date("2026-07-29T12:00:00.000Z"),
    );
    for (const error of [
      supportReferencedError("attacker-selected"),
      Object.defineProperty(new Error("unsafe-user-value"), "supportReference", {
        get(): never {
          throw new Error("credential-and-stack");
        },
      }),
      { supportReference: "r1_0123456789abcdef01234567" },
    ]) {
      session.recordFailure({
        routeCategory: "avd-rehearsal-verify",
        categoricalStatus: "unavailable",
        error,
      });
    }
    expect(session.createBundle()).toBeUndefined();
  });

  it("rejects hostile route and status values at the runtime boundary", () => {
    const session = createOperatorSupportBundleSession(
      () => new Date("2026-07-29T12:00:00.000Z"),
    );
    const referenceError =
      supportReferencedError("r1_0123456789abcdef01234567");
    const unsafeInputs: unknown[] = [
      {
        routeCategory: "attacker-route",
        categoricalStatus: "unavailable",
        error: referenceError,
      },
      {
        routeCategory: "avd-rehearsal-verify",
        categoricalStatus: {
          toJSON(): string {
            return "attacker-payload";
          },
        },
        error: referenceError,
      },
      Object.defineProperty({}, "routeCategory", {
        get(): never {
          throw new Error("hostile-getter");
        },
      }),
      null,
    ];
    for (const input of unsafeInputs) {
      session.recordFailure(input as Parameters<
        typeof session.recordFailure
      >[0]);
    }
    expect(session.createBundle()).toBeUndefined();
  });

  it("keeps only the newest bounded failures under the export byte cap", () => {
    const session = createOperatorSupportBundleSession(
      () => new Date("2026-07-29T12:00:00.000Z"),
    );
    for (let index = 0; index < OPERATOR_SUPPORT_BUNDLE_MAX_FAILURES + 4; index++) {
      session.recordFailure({
        routeCategory: "oauth-application-recon-rehearsal-verify",
        categoricalStatus: "verification-refused",
        error: supportReferencedError(
          `r1_${index.toString(16).padStart(24, "0")}`,
        ),
      });
    }
    const bundle = session.createBundle()!;
    expect(bundle.failures).toHaveLength(OPERATOR_SUPPORT_BUNDLE_MAX_FAILURES);
    expect(bundle.failures[0]?.supportReference).toBe(
      "r1_000000000000000000000004",
    );
    expect(
      new TextEncoder().encode(serializeOperatorSupportBundle(bundle)).byteLength,
    ).toBeLessThanOrEqual(OPERATOR_SUPPORT_BUNDLE_MAX_BYTES);
    session.clear();
    expect(session.createBundle()).toBeUndefined();
  });
});

function supportReferencedError(supportReference: string): Error {
  const error = new Error("Safe categorical failure");
  Object.defineProperty(error, "supportReference", {
    configurable: false,
    enumerable: false,
    value: supportReference,
    writable: false,
  });
  return error;
}
