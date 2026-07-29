import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  RehearsalOutputVerificationClientError,
  HttpAfterPartyApi,
} from "./client";
import {
  canonicalAvdThreeVmRehearsalOutput,
  verifyAvdThreeVmRehearsalOutput,
} from "../../scripts/verify-avd-three-vm-rehearsal-output";

describe("rehearsal output verification typed client", () => {
  it("posts the bounded envelope and validates the exact safe summary", async () => {
    const output = canonicalAvdThreeVmRehearsalOutput();
    const summary = verifyAvdThreeVmRehearsalOutput(output);
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(summary, 200),
    );
    const client = new HttpAfterPartyApi("https://api.example.test", request);

    await expect(
      client.verifyRehearsalOutput("signed-token", output),
    ).resolves.toEqual(summary);
    expect(request).toHaveBeenCalledWith(
      "https://api.example.test/api/rehearsal-output-verification",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: "Bearer signed-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(output),
      }),
    );
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [413, "request-too-large"],
    [503, "server-shutting-down"],
    [500, "safe-failure"],
  ] as const)("maps HTTP %s to fixed category %s", async (status, category) => {
    const client = clientReturning(
      jsonResponse(
        status === 503
          ? { error: "server_shutting_down" }
          : { error: "arbitrary private detail" },
        status,
      ),
    );

    await expect(
      client.verifyRehearsalOutput(
        "signed-token",
        canonicalAvdThreeVmRehearsalOutput(),
      ),
    ).rejects.toMatchObject({ category });
  });

  it("preserves only known verifier categories", async () => {
    const output = canonicalAvdThreeVmRehearsalOutput();
    const known = clientReturning(jsonResponse({
      error: "rehearsal_output_refused",
      category: "OBSERVATION_OVERCLAIM",
    }, 400));
    const unknown = clientReturning(jsonResponse({
      error: "rehearsal_output_refused",
      category: "ARBITRARY_SERVER_CATEGORY",
    }, 400));

    await expect(known.verifyRehearsalOutput("signed-token", output))
      .rejects.toEqual(
        new RehearsalOutputVerificationClientError(
          "validation-refused",
          "OBSERVATION_OVERCLAIM",
        ),
      );
    await expect(unknown.verifyRehearsalOutput("signed-token", output))
      .rejects.toMatchObject({ category: "safe-failure" });
  });

  it("rejects unsafe input before fetch", async () => {
    const request = vi.fn<typeof fetch>();
    const client = new HttpAfterPartyApi("https://api.example.test", request);
    const output = {
      ...canonicalAvdThreeVmRehearsalOutput(),
      proofReference: "external-proof",
    };

    await expect(
      client.verifyRehearsalOutput("signed-token", output),
    ).rejects.toMatchObject({
      category: "validation-refused",
      refusalCategory: "INPUT_SHAPE",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("streams under a hard response cap", async () => {
    const oversized = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(3_000));
        controller.enqueue(new Uint8Array(3_000));
        controller.close();
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(
      clientReturning(oversized).verifyRehearsalOutput(
        "signed-token",
        canonicalAvdThreeVmRehearsalOutput(),
      ),
    ).rejects.toMatchObject({ category: "response-too-large" });
  });

  it("rejects response mutation, raw echoes, wrong content type, and bad JSON", async () => {
    const output = canonicalAvdThreeVmRehearsalOutput();
    const summary = verifyAvdThreeVmRehearsalOutput(output);
    const cases = [
      jsonResponse({ ...summary, observations: "external" }, 200),
      jsonResponse({
        ...summary,
        claimCount: summary.claimCount + 1,
        missingCoverageTotal: summary.missingCoverageTotal + 1,
      }, 200),
      jsonResponse({
        ...summary,
        missingCoverageTotal: summary.missingCoverageTotal - 1,
      }, 200),
      jsonResponse({ ...summary, upstreamPayload: output }, 200),
      new Response(JSON.stringify(summary), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ];
    for (const response of cases) {
      await expect(
        clientReturning(response).verifyRehearsalOutput(
          "signed-token",
          output,
        ),
      ).rejects.toMatchObject({ category: "safe-failure" });
    }
  });

  it("maps the server response cap category", async () => {
    const client = clientReturning(jsonResponse({
      error: "rehearsal_output_response_too_large",
    }, 500));
    await expect(
      client.verifyRehearsalOutput(
        "signed-token",
        canonicalAvdThreeVmRehearsalOutput(),
      ),
    ).rejects.toMatchObject({ category: "response-too-large" });
  });

  it("loads directly in Node without a server-only runner import", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "await import('./src/api/client.ts'); process.stdout.write('ok')",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("ok");
  });
});

function clientReturning(response: Response): HttpAfterPartyApi {
  return new HttpAfterPartyApi(
    "https://api.example.test",
    vi.fn<typeof fetch>().mockResolvedValue(response),
  );
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
