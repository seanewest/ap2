import { describe, expect, it } from "vitest";
import {
  AFTER_PARTY_CLIENT_ID,
  ORGANIZATIONS_AUTHORITY,
  resolveApplicationUrl,
  SIGN_IN_SCOPES,
} from "./config";

describe("public Microsoft identity configuration", () => {
  it("uses the existing multitenant application and identity-only scopes", () => {
    expect(AFTER_PARTY_CLIENT_ID).toBe(
      "c91c7af4-b1b8-4730-a240-4a1c6137ab15",
    );
    expect(ORGANIZATIONS_AUTHORITY).toBe(
      "https://login.microsoftonline.com/organizations",
    );
    expect(SIGN_IN_SCOPES).toEqual(["openid", "profile"]);
  });

  it("resolves the exact local and GitHub Pages redirect URLs", () => {
    expect(resolveApplicationUrl("http://localhost:5173", "/")).toBe(
      "http://localhost:5173/",
    );
    expect(
      resolveApplicationUrl("https://seanewest.github.io", "/ap2/"),
    ).toBe("https://seanewest.github.io/ap2/");
  });
});
