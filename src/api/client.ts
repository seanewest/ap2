export interface ApiCallerIdentity {
  callerType: "delegated" | "app-only";
  tenantId: string;
}

const runningStatuses = [
  "Progressing",
  "Running",
  "Stopped",
  "Suspended",
  "Ready",
] as const;

export interface RehearsalStatus {
  appName: string;
  region: string;
  runningStatus: (typeof runningStatuses)[number];
  latestReadyRevision: string;
}

export interface SimulatedEmailResult {
  accepted: true;
  sender: string;
  recipient: string;
  subject: string;
}

export interface AfterPartyApi {
  checkAccess(accessToken: string): Promise<ApiCallerIdentity>;
  getRehearsalStatus(accessToken: string): Promise<RehearsalStatus>;
  sendSimulatedEmail(accessToken: string): Promise<SimulatedEmailResult>;
}

export class ApiAccessError extends Error {
  constructor(message = "The API could not complete the access check. Try again.") {
    super(message);
    this.name = "ApiAccessError";
  }
}

export class HttpAfterPartyApi implements AfterPartyApi {
  private readonly whoAmIUrl: string;
  private readonly rehearsalStatusUrl: string;
  private readonly simulatedEmailUrl: string;
  private readonly request: typeof fetch;

  constructor(baseUrl: string, request: typeof fetch = fetch) {
    this.whoAmIUrl = new URL("api/whoami", `${baseUrl}/`).toString();
    this.rehearsalStatusUrl = new URL(
      "api/rehearsal-status",
      `${baseUrl}/`,
    ).toString();
    this.simulatedEmailUrl = new URL(
      "api/simulated-email",
      `${baseUrl}/`,
    ).toString();
    this.request = request.bind(globalThis);
  }

  async checkAccess(accessToken: string): Promise<ApiCallerIdentity> {
    const value = await this.getAuthorizedJson(this.whoAmIUrl, accessToken);
    if (!isSafeCallerIdentity(value)) {
      throw new ApiAccessError();
    }

    return {
      callerType: value.callerType,
      tenantId: value.tenantId,
    };
  }

  async getRehearsalStatus(accessToken: string): Promise<RehearsalStatus> {
    const value = await this.getAuthorizedJson(
      this.rehearsalStatusUrl,
      accessToken,
    );
    if (!isSafeRehearsalStatus(value)) {
      throw new ApiAccessError();
    }

    return {
      appName: value.appName,
      region: value.region,
      runningStatus: value.runningStatus,
      latestReadyRevision: value.latestReadyRevision,
    };
  }

  async sendSimulatedEmail(
    accessToken: string,
  ): Promise<SimulatedEmailResult> {
    const value = await this.getAuthorizedJson(
      this.simulatedEmailUrl,
      accessToken,
      "POST",
      202,
    );
    if (!isSafeSimulatedEmailResult(value)) {
      throw new ApiAccessError();
    }

    return {
      accepted: true,
      sender: value.sender,
      recipient: value.recipient,
      subject: value.subject,
    };
  }

  private async getAuthorizedJson(
    url: string,
    accessToken: string,
    method = "GET",
    expectedStatus?: number,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(url, {
        method,
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
    if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
      throw new ApiAccessError();
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiAccessError();
    }
    return value;
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

function isSafeRehearsalStatus(value: unknown): value is RehearsalStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const status = value as Record<string, unknown>;
  return (
    typeof status.appName === "string" &&
    status.appName.length > 0 &&
    typeof status.region === "string" &&
    status.region.length > 0 &&
    runningStatuses.some((candidate) => candidate === status.runningStatus) &&
    typeof status.latestReadyRevision === "string" &&
    status.latestReadyRevision.length > 0
  );
}

function isSafeSimulatedEmailResult(
  value: unknown,
): value is SimulatedEmailResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    result.accepted === true &&
    typeof result.sender === "string" &&
    result.sender.length > 0 &&
    typeof result.recipient === "string" &&
    result.recipient.length > 0 &&
    typeof result.subject === "string" &&
    result.subject.length > 0
  );
}
