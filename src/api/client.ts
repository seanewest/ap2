export interface ApiCallerIdentity {
  callerType: "delegated" | "app-only";
  tenantId: string;
}

export interface AfterPartyApi {
  checkAccess(accessToken: string): Promise<ApiCallerIdentity>;
}

export class ApiAccessError extends Error {
  constructor(message = "The API could not complete the access check. Try again.") {
    super(message);
    this.name = "ApiAccessError";
  }
}

export class HttpAfterPartyApi implements AfterPartyApi {
  private readonly whoAmIUrl: string;
  private readonly request: typeof fetch;

  constructor(baseUrl: string, request: typeof fetch = fetch) {
    this.whoAmIUrl = new URL("api/whoami", `${baseUrl}/`).toString();
    this.request = request;
  }

  async checkAccess(accessToken: string): Promise<ApiCallerIdentity> {
    let response: Response;
    try {
      response = await this.request(this.whoAmIUrl, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      throw new ApiAccessError();
    }

    if (response.status === 401) {
      throw new ApiAccessError("API access needs Microsoft authorization. Try again.");
    }
    if (response.status === 403) {
      throw new ApiAccessError("This account is not allowed to use the API.");
    }
    if (!response.ok) {
      throw new ApiAccessError();
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiAccessError();
    }
    if (!isSafeCallerIdentity(value)) {
      throw new ApiAccessError();
    }

    return {
      callerType: value.callerType,
      tenantId: value.tenantId,
    };
  }
}

function isSafeCallerIdentity(value: unknown): value is ApiCallerIdentity {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const caller = value as Record<string, unknown>;
  return (
    (caller.callerType === "delegated" || caller.callerType === "app-only") &&
    typeof caller.tenantId === "string" &&
    caller.tenantId.length > 0
  );
}
