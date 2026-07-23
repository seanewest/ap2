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

export const ONEDRIVE_PROOF_PATH = "/AP2-OneDrive-share-proof.txt";
const ONEDRIVE_PROOF_OWNER =
  "homer.simpson@corywest.onmicrosoft.com";
const ONEDRIVE_PROOF_RECIPIENT =
  "marge.simpson@corywest.onmicrosoft.com";

export type OneDriveProofResult =
  | {
      state: "shared";
      path: typeof ONEDRIVE_PROOF_PATH;
      owner: typeof ONEDRIVE_PROOF_OWNER;
      recipient: typeof ONEDRIVE_PROOF_RECIPIENT;
      access: "read";
    }
  | {
      state: "verified";
      path: typeof ONEDRIVE_PROOF_PATH;
      verifiedAs: typeof ONEDRIVE_PROOF_RECIPIENT;
      contentMatches: true;
    }
  | {
      state: "removed";
      path: typeof ONEDRIVE_PROOF_PATH;
    };

const SIMULATED_EMAIL_SENDER =
  "homer.simpson@corywest.onmicrosoft.com";
const SIMULATED_EMAIL_RECIPIENT =
  "marge.simpson@corywest.onmicrosoft.com";
const SIMULATED_EMAIL_SUBJECT = "Dinner tonight";

export interface AfterPartyApi {
  checkAccess(accessToken: string): Promise<ApiCallerIdentity>;
  getRehearsalStatus(accessToken: string): Promise<RehearsalStatus>;
  sendSimulatedEmail(accessToken: string): Promise<SimulatedEmailResult>;
  shareOneDriveProof(
    accessToken: string,
  ): Promise<Extract<OneDriveProofResult, { state: "shared" }>>;
  verifyOneDriveProof(
    accessToken: string,
  ): Promise<Extract<OneDriveProofResult, { state: "verified" }>>;
  removeOneDriveProof(
    accessToken: string,
  ): Promise<Extract<OneDriveProofResult, { state: "removed" }>>;
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
  private readonly oneDriveProofUrl: string;
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
    this.oneDriveProofUrl = new URL(
      "api/onedrive-share-proof",
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

  async shareOneDriveProof(
    accessToken: string,
  ): Promise<Extract<OneDriveProofResult, { state: "shared" }>> {
    const result = await this.oneDriveProofRequest(
      accessToken,
      "POST",
      201,
      "shared",
    );
    return {
      state: "shared",
      path: result.path,
      owner: result.owner,
      recipient: result.recipient,
      access: result.access,
    };
  }

  async verifyOneDriveProof(
    accessToken: string,
  ): Promise<Extract<OneDriveProofResult, { state: "verified" }>> {
    const result = await this.oneDriveProofRequest(
      accessToken,
      "GET",
      200,
      "verified",
    );
    return {
      state: "verified",
      path: result.path,
      verifiedAs: result.verifiedAs,
      contentMatches: true,
    };
  }

  async removeOneDriveProof(
    accessToken: string,
  ): Promise<Extract<OneDriveProofResult, { state: "removed" }>> {
    const result = await this.oneDriveProofRequest(
      accessToken,
      "DELETE",
      200,
      "removed",
    );
    return { state: "removed", path: result.path };
  }

  private async oneDriveProofRequest<T extends OneDriveProofResult["state"]>(
    accessToken: string,
    method: "GET" | "POST" | "DELETE",
    expectedStatus: number,
    expectedState: T,
  ): Promise<Extract<OneDriveProofResult, { state: T }>> {
    const value = await this.getAuthorizedJson(
      this.oneDriveProofUrl,
      accessToken,
      method,
      expectedStatus,
    );
    if (!isSafeOneDriveProofResult(value) || value.state !== expectedState) {
      throw new ApiAccessError();
    }
    return value as Extract<OneDriveProofResult, { state: T }>;
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
    if (response.status === 409) {
      const error = await readErrorCode(response);
      if (error === "proof_operation_busy") {
        throw new ApiAccessError(
          "Another OneDrive proof operation is running. Try again shortly.",
        );
      }
      throw new ApiAccessError(
        "The OneDrive proof file is not in the expected state. Nothing was changed.",
      );
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

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const value: unknown = await response.json();
    return typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "string"
      ? value.error
      : undefined;
  } catch {
    return undefined;
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
    result.sender === SIMULATED_EMAIL_SENDER &&
    result.recipient === SIMULATED_EMAIL_RECIPIENT &&
    result.subject === SIMULATED_EMAIL_SUBJECT
  );
}

function isSafeOneDriveProofResult(
  value: unknown,
): value is OneDriveProofResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  if (result.path !== ONEDRIVE_PROOF_PATH) {
    return false;
  }
  if (result.state === "shared") {
    return (
      result.owner === ONEDRIVE_PROOF_OWNER &&
      result.recipient === ONEDRIVE_PROOF_RECIPIENT &&
      result.access === "read"
    );
  }
  if (result.state === "verified") {
    return (
      result.verifiedAs === ONEDRIVE_PROOF_RECIPIENT &&
      result.contentMatches === true
    );
  }
  return result.state === "removed";
}
