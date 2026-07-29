import { describe, expect, it } from "vitest";
import {
  API_SUPPORT_REFERENCE_HEADER,
  API_SUPPORT_REFERENCE_PATTERN,
  apiSupportReferenceFromError,
  readApiSupportReference,
  withApiSupportReference,
} from "./support-reference.ts";

const reference = "r1_0123456789abcdef01234567";

describe("API support references", () => {
  it("accepts only the bounded server-generated format", () => {
    expect(API_SUPPORT_REFERENCE_PATTERN.test(reference)).toBe(true);
    expect(
      readApiSupportReference(
        new Headers({
          [API_SUPPORT_REFERENCE_HEADER]: reference,
        }),
      ),
    ).toBe(reference);
    for (const unsafe of [
      "r1_0123456789ABCDEF01234567",
      "r1_0123456789abcdef012345678",
      "request-from-browser",
      "unsafe@example.test",
      "/private/evidence",
    ]) {
      expect(
        readApiSupportReference(
          new Headers({
            [API_SUPPORT_REFERENCE_HEADER]: unsafe,
          }),
        ),
      ).toBeUndefined();
    }
  });

  it("renders only a validated error reference beside a fixed safe message", () => {
    const error = Object.assign(new Error("unsafe upstream detail"), {
      supportReference: reference,
    });
    expect(apiSupportReferenceFromError(error)).toBe(reference);
    expect(withApiSupportReference("Request failed.", error)).toBe(
      `Request failed. Support reference: ${reference}.`,
    );
    expect(
      withApiSupportReference("Request failed.", {
        supportReference: reference,
      }),
    ).toBe("Request failed.");
    expect(
      withApiSupportReference(
        "Request failed.",
        Object.assign(new Error("unsafe"), {
          supportReference: "attacker-selected",
        }),
      ),
    ).toBe("Request failed.");
  });
});
