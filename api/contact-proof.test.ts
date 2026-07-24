// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { STUDENT_TENANT_ID } from "./identity.js";
import {
  CONTACT_DISPLAY_NAME,
  CONTACT_EMAIL,
  CONTACT_RUN_ID,
  CONTACT_RUN_PROPERTY_ID,
  ContactProofConflictError,
  DelegatedGraphContactProof,
  GRAPH_CONTACTS_READ_WRITE_SCOPE,
} from "./contact-proof.js";
import {
  coryIdentity,
  type DelegatedGraphTokenProvider,
} from "./simulated-user.js";

const CORY_OBJECT_ID = "11111111-1111-4111-8111-111111111111";
const cory = coryIdentity(CORY_OBJECT_ID);

function storedContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact/id",
    displayName: CONTACT_DISPLAY_NAME,
    givenName: "AP2",
    surname: "Kobe Contact Proof",
    emailAddresses: [{ address: CONTACT_EMAIL }],
    businessPhones: [],
    homePhones: [],
    mobilePhone: null,
    businessAddress: {},
    homeAddress: {},
    otherAddress: {},
    companyName: null,
    personalNotes: "",
    singleValueExtendedProperties: [
      { id: CONTACT_RUN_PROPERTY_ID, value: CONTACT_RUN_ID },
    ],
    ...overrides,
  };
}

function fixture(responses: readonly Response[]) {
  const queue = [...responses];
  const request = vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(async () => {
    const response = queue.shift();
    if (!response) {
      throw new Error("Unexpected Graph request");
    }
    return response;
  });
  const tokens = {
    getToken: vi.fn(async () => ({
      token: "cory-contact-token",
      identity: cory,
    })),
  } satisfies DelegatedGraphTokenProvider;
  return {
    operation: new DelegatedGraphContactProof(
      tokens,
      cory,
      request as typeof fetch,
    ),
    request,
    tokens,
  };
}

describe("DelegatedGraphContactProof", () => {
  it("filters the exact marker, then creates only the fixed contact once", async () => {
    const test = fixture([
      Response.json({ value: [] }),
      Response.json(storedContact({
        singleValueExtendedProperties: undefined,
      }), { status: 201 }),
    ]);

    await expect(test.operation.create()).resolves.toEqual({
      state: "configured",
      displayName: CONTACT_DISPLAY_NAME,
      email: CONTACT_EMAIL,
    });
    expect(test.tokens.getToken).toHaveBeenCalledWith(
      GRAPH_CONTACTS_READ_WRITE_SCOPE,
    );
    expect(test.request).toHaveBeenCalledTimes(2);

    const lookup = new URL(String(test.request.mock.calls[0]![0]));
    expect(lookup.pathname).toBe("/v1.0/me/contacts");
    expect(lookup.searchParams.get("$top")).toBe("2");
    expect(lookup.searchParams.get("$filter")).toBe(
      `singleValueExtendedProperties/Any(ep: ep/id eq '${CONTACT_RUN_PROPERTY_ID}' and ep/value eq '${CONTACT_RUN_ID}')`,
    );

    const [createUrl, createInit] = test.request.mock.calls[1]!;
    expect(String(createUrl)).toBe(
      "https://graph.microsoft.com/v1.0/me/contacts",
    );
    expect(createInit).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer cory-contact-token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(createInit?.body))).toEqual({
      displayName: CONTACT_DISPLAY_NAME,
      givenName: "AP2",
      surname: "Kobe Contact Proof",
      emailAddresses: [{ address: CONTACT_EMAIL }],
      singleValueExtendedProperties: [
        { id: CONTACT_RUN_PROPERTY_ID, value: CONTACT_RUN_ID },
      ],
    });
  });

  it("returns Configured for one exact existing marker without creating", async () => {
    const test = fixture([
      Response.json({ value: [storedContact()] }),
    ]);

    await expect(test.operation.create()).resolves.toMatchObject({
      state: "configured",
    });
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["duplicates", { value: [storedContact(), storedContact({ id: "two" })] }],
    ["wrong contact", { value: [storedContact({ surname: "Wrong" })] }],
    ["pagination", { value: [storedContact()], "@odata.nextLink": "next" }],
    ["malformed", { value: "not-an-array" }],
  ])("refuses %s without a create mutation", async (_name, body) => {
    const test = fixture([Response.json(body)]);

    await expect(test.operation.create()).rejects.toBeInstanceOf(
      ContactProofConflictError,
    );
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it("does not retry an unconfirmed create mutation", async () => {
    const test = fixture([
      Response.json({ value: [] }),
      Response.json(storedContact({ emailAddresses: [] }), { status: 201 }),
    ]);

    await expect(test.operation.create()).rejects.toThrow(
      "contact creation returned an unconfirmed",
    );
    expect(test.request).toHaveBeenCalledTimes(2);
  });

  it("removes one exact contact once and treats absence as removed", async () => {
    const present = fixture([
      Response.json({ value: [storedContact()] }),
      new Response(undefined, { status: 204 }),
    ]);
    await expect(present.operation.remove()).resolves.toEqual({
      state: "removed",
      displayName: CONTACT_DISPLAY_NAME,
    });
    expect(present.request).toHaveBeenCalledTimes(2);
    expect(present.request.mock.calls[1]![0]).toBe(
      "https://graph.microsoft.com/v1.0/me/contacts/contact%2Fid",
    );
    expect(present.request.mock.calls[1]![1]).toMatchObject({
      method: "DELETE",
      redirect: "error",
    });

    const absent = fixture([Response.json({ value: [] })]);
    await expect(absent.operation.remove()).resolves.toMatchObject({
      state: "removed",
    });
    expect(absent.request).toHaveBeenCalledTimes(1);
  });

  it("never deletes an ambiguous or mismatched marker result", async () => {
    for (const body of [
      { value: [storedContact({ companyName: "Unexpected" })] },
      { value: [storedContact(), storedContact({ id: "two" })] },
      { value: [storedContact()], "@odata.nextLink": "next" },
    ]) {
      const test = fixture([Response.json(body)]);
      await expect(test.operation.remove()).rejects.toBeInstanceOf(
        ContactProofConflictError,
      );
      expect(test.request).toHaveBeenCalledTimes(1);
    }
  });

  it("does not retry an unconfirmed delete and rejects a wrong Cory token", async () => {
    const failedDelete = fixture([
      Response.json({ value: [storedContact()] }),
      Response.json({ error: "failure" }, { status: 503 }),
    ]);
    await expect(failedDelete.operation.remove()).rejects.toThrow(
      "contact removal returned HTTP 503",
    );
    expect(failedDelete.request).toHaveBeenCalledTimes(2);

    const wrongTokens = {
      getToken: vi.fn(async () => ({
        token: "wrong",
        identity: { ...cory, tenantId: STUDENT_TENANT_ID.replace("9", "8") },
      })),
    };
    const request = vi.fn();
    const operation = new DelegatedGraphContactProof(
      wrongTokens,
      cory,
      request as typeof fetch,
    );
    await expect(operation.create()).rejects.toThrow(
      "Delegated Graph token is not for Cory West",
    );
    expect(request).not.toHaveBeenCalled();
  });
});
