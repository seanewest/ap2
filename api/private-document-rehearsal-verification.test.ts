import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PrivateDocumentRehearsalVerificationError,
  verifyPrivateDocumentRehearsalOutput,
} from "../scripts/verify-private-document-rehearsal-output";
import {
  PRIVATE_DOCUMENT_REHEARSAL_VERIFICATION_FAILURES,
  type PrivateDocumentRehearsalVerificationRequest,
} from "../src/api/private-document-rehearsal-verification-contract";
import {
  InMemoryPrivateDocumentRehearsalVerificationService,
  PrivateDocumentRehearsalVerificationSafeFailureError,
} from "./private-document-rehearsal-verification";

describe("in-memory private-document rehearsal verification service", () => {
  it.each(["cleaned", "learner"] as const)(
    "verifies the captured %s branch using PR #94 directly",
    (branch) => {
      const verifier = vi.fn(verifyPrivateDocumentRehearsalOutput);
      const service =
        new InMemoryPrivateDocumentRehearsalVerificationService(verifier);
      const request = fixture(branch);

      expect(service.verify(request)).toMatchObject({
        label: "REHEARSAL_ONLY_VERIFIED",
        scenarioId: "private-document-evidence",
        planDigestSha256: request.binding!.planDigestSha256,
        fakeRunDigestSha256: request.binding!.fakeRunDigestSha256,
        syntheticBranch: request.binding!.syntheticBranch,
        claimCount: request.receipt!.candidateClaimCount,
      });
      expect(verifier).toHaveBeenCalledOnce();
      expect(verifier).toHaveBeenCalledWith(request);
    },
  );

  it("preserves fixed PR #94 refusal categories", () => {
    const request = fixture();
    (request.binding as { syntheticBranch: string }).syntheticBranch =
      "learner-observation";
    const service = new InMemoryPrivateDocumentRehearsalVerificationService();

    expect(() => service.verify(request)).toThrow(
      new PrivateDocumentRehearsalVerificationError("BRANCH_MISMATCH"),
    );
  });

  it.each(PRIVATE_DOCUMENT_REHEARSAL_VERIFICATION_FAILURES)(
    "preserves the fixed %s verifier category without arbitrary detail",
    (category) => {
      const service =
        new InMemoryPrivateDocumentRehearsalVerificationService(() => {
          throw new PrivateDocumentRehearsalVerificationError(category);
        });
      expect(() => service.verify(fixture())).toThrow(
        new PrivateDocumentRehearsalVerificationError(category),
      );
    },
  );

  it("isolates arbitrary verifier failures and summary tampering", () => {
    const thrown = new InMemoryPrivateDocumentRehearsalVerificationService(
      () => {
        throw new Error("private exception detail");
      },
    );
    const tampered = new InMemoryPrivateDocumentRehearsalVerificationService(
      (value) => ({
        ...verifyPrivateDocumentRehearsalOutput(value),
        claimCount: 0,
      }),
    );

    expect(() => thrown.verify(fixture())).toThrow(
      PrivateDocumentRehearsalVerificationSafeFailureError,
    );
    expect(() => tampered.verify(fixture())).toThrow(
      PrivateDocumentRehearsalVerificationSafeFailureError,
    );
  });

  it("has no lifecycle, runner, transport, persistence, retry, or telemetry call", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "api/private-document-rehearsal-verification.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/runPrivateDocumentRehearsal/);
    expect(source).not.toMatch(/createDeterministicPrivateDocument/);
    expect(source).not.toMatch(/PrivateDocumentEvidenceRunner/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry/i);
    expect(source).not.toMatch(/\btelemetry/i);
    expect(source).not.toMatch(/\.execute\s*\(/);
  });
});

function fixture(
  branch: "cleaned" | "learner" = "cleaned",
): PrivateDocumentRehearsalVerificationRequest {
  const name = branch === "cleaned"
    ? "private-document-rehearsal-output-cleaned.json"
    : "private-document-rehearsal-output-learner.json";
  return JSON.parse(
    readFileSync(join(process.cwd(), "scripts/fixtures", name), "utf8"),
  ) as PrivateDocumentRehearsalVerificationRequest;
}
