import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CallerNotAllowedError,
  InvalidClaimsError,
  authorizeClaims,
  type AuthorizedCaller,
  type CallerPolicy,
} from "./auth-policy.js";
import {
  CalendarMeetingBusyError,
  CalendarMeetingConflictError,
  type CalendarMeetingOperation,
} from "./calendar-meeting.js";
import { CategoryProofConflictError, type CategoryProofOperation } from "./category-proof.js";
import { ContactProofConflictError, type ContactProofOperation } from "./contact-proof.js";
import {
  InboxRuleProofConflictError,
  type InboxRuleProofOperation,
} from "./inbox-rule-proof.js";
import {
  DraftProofConflictError,
  type DraftProofOperation,
} from "./draft-proof.js";
import {
  TodoTaskProofConflictError,
  type TodoTaskProofOperation,
} from "./todo-task-proof.js";
import type { RehearsalStatusProvider } from "./rehearsal-status.js";
import {
  SharePointFileProofConflictError,
  type SharePointFileProofOperation,
} from "./sharepoint-file-proof.js";
import type { SimulatedEmailOperation } from "./simulated-email.js";
import type { HelpDeskScenarioOperation } from "./help-desk-scenario.js";
import {
  OneDriveInviteFailureError,
  OneDriveProofBusyError,
  OneDriveProofConflictError,
  type OneDriveShareProofOperation,
} from "./onedrive-share-proof.js";
import { InvalidTokenError, type TokenVerifier } from "./token-verifier.js";
import {
  OPERATION_TELEMETRY_ORDERS,
  type OperationTelemetryReader,
} from "./operation-telemetry-collector.js";
import {
  ScenarioPlanResponseTooLargeError,
  ScenarioPlanSafeFailureError,
  type ScenarioPlanService,
} from "./scenario-plan.js";
import { ScenarioPlanError } from "../src/scenarios/scenario-plan.js";
import {
  ScenarioEvidenceVerificationResponseTooLargeError,
  ScenarioEvidenceVerificationSafeFailureError,
  type ScenarioEvidenceVerificationService,
} from "./scenario-evidence-verification.js";
import { EvidenceReceiptError } from "../src/scenarios/scenario-evidence-receipt.js";
import {
  RehearsalOutputVerificationResponseTooLargeError,
  RehearsalOutputVerificationSafeFailureError,
  type RehearsalOutputVerificationService,
} from "./rehearsal-output-verification.js";
import { RehearsalOutputVerificationError } from "../scripts/verify-avd-three-vm-rehearsal-output.js";
import {
  BatchFeasibilityRefusalError,
  BatchFeasibilityResponseTooLargeError,
  BatchFeasibilitySafeFailureError,
  type MultiScenarioFeasibilityService,
} from "./multi-scenario-feasibility.js";
import {
  PrivateDocumentRehearsalVerificationResponseTooLargeError,
  PrivateDocumentRehearsalVerificationSafeFailureError,
  type PrivateDocumentRehearsalVerificationService,
} from "./private-document-rehearsal-verification.js";
import {
  PrivateDocumentRehearsalVerificationError,
} from "../scripts/verify-private-document-rehearsal-output.js";
import {
  PrivateDocumentRehearsalContractError,
} from "../src/api/private-document-rehearsal-verification-contract.js";
import {
  HelpDeskEmailRehearsalVerificationResponseTooLargeError,
  HelpDeskEmailRehearsalVerificationSafeFailureError,
  type HelpDeskEmailRehearsalVerificationService,
} from "./help-desk-email-rehearsal-verification.js";
import {
  HelpDeskEmailRehearsalVerificationError,
} from "../scripts/verify-help-desk-email-rehearsal-output.js";
import {
  HelpDeskEmailRehearsalContractError,
} from "../src/api/help-desk-email-rehearsal-verification-contract.js";
import {
  apiRouteContractsForPath,
  findApiRouteContract,
  type ApiRouteContract,
  type ApiRouteOwnerKey,
} from "../src/api/api-route-contract.js";
import {
  TeamsMissedCallRehearsalVerificationResponseTooLargeError,
  TeamsMissedCallRehearsalVerificationSafeFailureError,
  type TeamsMissedCallRehearsalVerificationService,
} from "./teams-missed-call-rehearsal-verification.js";
import {
  TeamsMissedCallRehearsalVerificationError,
} from "../scripts/verify-teams-missed-call-rehearsal-output.js";
import {
  TeamsMissedCallRehearsalContractError,
} from "../src/api/teams-missed-call-rehearsal-verification-contract.js";
import {
  OauthApplicationReconRehearsalVerificationResponseTooLargeError,
  OauthApplicationReconRehearsalVerificationSafeFailureError,
  type OauthApplicationReconRehearsalVerificationService,
} from "./oauth-application-recon-rehearsal-verification.js";
import {
  OauthApplicationReconRehearsalVerificationError,
} from "../scripts/verify-oauth-application-recon-rehearsal-output.js";
import {
  OauthApplicationReconRehearsalContractError,
} from "../src/api/oauth-application-recon-rehearsal-verification-contract.js";

export interface ApiDependencies {
  tokenVerifier: TokenVerifier;
  callerPolicy: CallerPolicy;
  rehearsalStatusProvider: RehearsalStatusProvider;
  simulatedEmailOperation?: SimulatedEmailOperation;
  helpDeskScenarioOperation?: HelpDeskScenarioOperation;
  oneDriveShareProofOperation?: OneDriveShareProofOperation;
  calendarMeetingOperation?: CalendarMeetingOperation;
  contactProofOperation?: ContactProofOperation;
  inboxRuleProofOperation?: InboxRuleProofOperation;
  categoryProofOperation?: CategoryProofOperation;
  sharePointFileProofOperation?: SharePointFileProofOperation;
  draftProofOperation?: DraftProofOperation;
  todoTaskProofOperation?: TodoTaskProofOperation;
  operationTelemetryReader?: OperationTelemetryReader;
  scenarioPlanService?: ScenarioPlanService;
  scenarioEvidenceVerificationService?: ScenarioEvidenceVerificationService;
  rehearsalOutputVerificationService?: RehearsalOutputVerificationService;
  privateDocumentRehearsalVerificationService?:
    PrivateDocumentRehearsalVerificationService;
  helpDeskEmailRehearsalVerificationService?:
    HelpDeskEmailRehearsalVerificationService;
  teamsMissedCallRehearsalVerificationService?:
    TeamsMissedCallRehearsalVerificationService;
  oauthApplicationReconRehearsalVerificationService?:
    OauthApplicationReconRehearsalVerificationService;
  multiScenarioFeasibilityService?: MultiScenarioFeasibilityService;
  allowedOrigin?: string;
}

export function createApiServer(dependencies: ApiDependencies): Server {
  return createServer((request, response) => {
    void route(request, response, dependencies).catch(() => {
      sendJson(response, 500, { error: "internal_server_error" });
    });
  });
}

const responseRouteContracts = new WeakMap<ServerResponse, ApiRouteContract>();

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const contract = findApiRouteContract(request.method, pathname);
  if (contract) responseRouteContracts.set(response, contract);
  const origin = request.headers.origin;
  if (origin) {
    if (!dependencies.allowedOrigin || origin !== dependencies.allowedOrigin) {
      sendJson(response, 403, { error: "origin_not_allowed" });
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }

  if (request.method === "OPTIONS") {
    const preflight = apiRouteContractsForPath(pathname).filter(
      ({ authorization }) => authorization === "operator",
    );
    if (preflight.length > 0) {
      handleProtectedPreflight(
        request,
        response,
        origin,
        [...new Set(preflight.map(({ method }) => method))],
        [
          "authorization",
          ...(preflight.some(({ requestContent }) =>
              requestContent === "json"
            )
            ? ["content-type"]
            : []),
        ],
      );
      return;
    }
  }
  if (!contract) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  switch (contract.ownerKey) {
    case "health":
      sendJson(response, 200, { status: "ok" });
      return;
    case "whoami":
      await whoAmI(request, response, dependencies);
      return;
    case "rehearsal-status":
      await rehearsalStatus(request, response, dependencies);
      return;
    case "operation-events":
      await operationEvents(request, response, dependencies);
      return;
    case "simulated-email-send":
      await simulatedEmail(request, response, dependencies);
      return;
    case "help-desk-scenario-send":
      await helpDeskScenario(request, response, dependencies);
      return;
    case "scenario-plan-compile":
      await scenarioPlan(
        request,
        response,
        dependencies,
        contract.requestMaxBytes,
      );
      return;
    case "scenario-receipt-verify":
      await scenarioEvidenceVerification(
        request,
        response,
        dependencies,
        contract.requestMaxBytes,
      );
      return;
    case "avd-rehearsal-verify":
      await rehearsalOutputVerification(
        request,
        response,
        dependencies,
        contract.requestMaxBytes,
      );
      return;
    case "private-document-rehearsal-verify":
      await privateDocumentRehearsalVerification(
        request,
        response,
        dependencies,
        contract.requestMaxBytes,
      );
      return;
    case "help-desk-email-rehearsal-verify":
      await helpDeskEmailRehearsalVerification(
        request,
        response,
        dependencies,
        contract.requestMaxBytes,
      );
      return;
    case "teams-missed-call-rehearsal-verify":
      await teamsMissedCallRehearsalVerification(
        request,
        response,
        dependencies,
        contract.requestMaxBytes,
      );
      return;
    case "oauth-application-recon-rehearsal-verify":
      await oauthApplicationReconRehearsalVerification(
        request,
        response,
        dependencies,
        contract.requestMaxBytes,
      );
      return;
    case "batch-feasibility-calculate":
      await multiScenarioFeasibility(
        request,
        response,
        dependencies,
        contract.requestMaxBytes,
      );
      return;
    case "onedrive-proof-create":
      await oneDriveShareProof(request, response, dependencies, "share");
      return;
    case "onedrive-proof-remove":
      await oneDriveShareProof(request, response, dependencies, "remove");
      return;
    case "calendar-meeting-create":
      await calendarMeeting(request, response, dependencies, "create");
      return;
    case "calendar-meeting-cancel":
      await calendarMeeting(request, response, dependencies, "cancel");
      return;
    case "contact-proof-create":
    case "inbox-rule-proof-create":
    case "category-proof-create":
    case "sharepoint-file-proof-create":
    case "draft-proof-create":
    case "todo-task-proof-create":
      await fixedProof(
        request,
        response,
        dependencies,
        contract.ownerKey,
        "create",
      );
      return;
    case "contact-proof-remove":
    case "inbox-rule-proof-remove":
    case "category-proof-remove":
    case "sharepoint-file-proof-remove":
    case "draft-proof-remove":
    case "todo-task-proof-remove":
      await fixedProof(
        request,
        response,
        dependencies,
        contract.ownerKey,
        "remove",
      );
      return;
    default:
      assertNeverOwner(contract.ownerKey);
  }
}

function handleProtectedPreflight(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string | undefined,
  methods: readonly ("GET" | "POST" | "DELETE")[],
  allowedHeaders: readonly string[] = ["authorization"],
): void {
  const requestedHeaders = (
    request.headers["access-control-request-headers"] ?? ""
  )
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (
    !origin ||
    !methods.includes(
      request.headers["access-control-request-method"] as
        | "GET"
        | "POST"
        | "DELETE",
    ) ||
    requestedHeaders.length !== allowedHeaders.length ||
    !allowedHeaders.every((header) => requestedHeaders.includes(header))
  ) {
    sendJson(response, 403, { error: "cors_preflight_rejected" });
    return;
  }

  response.writeHead(204, {
    "Access-Control-Allow-Headers": allowedHeaders
      .map((header) =>
        header
          .split("-")
          .map((part) => part[0]?.toUpperCase() + part.slice(1))
          .join("-"),
      )
      .join(", "),
    "Access-Control-Allow-Methods": methods.join(", "),
    "Cache-Control": "no-store",
  });
  response.end();
}

async function whoAmI(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  await handleAuthorizedRequest(
    request,
    response,
    dependencies,
    (caller) => caller,
  );
}

async function rehearsalStatus(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  await handleAuthorizedRequest(request, response, dependencies, () =>
    dependencies.rehearsalStatusProvider.getStatus(),
  );
}

async function operationEvents(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  await handleAuthorizedRequest(request, response, dependencies, () => {
    const order = operationEventOrder(request.url);
    if (!dependencies.operationTelemetryReader) {
      throw new Error("Operation telemetry reader is not configured");
    }
    return dependencies.operationTelemetryReader.snapshot(order);
  });
}

class InvalidOperationEventQueryError extends Error {}

function operationEventOrder(
  requestUrl: string | undefined,
): typeof OPERATION_TELEMETRY_ORDERS[number] {
  const url = new URL(requestUrl ?? "/", "http://localhost");
  const orderValues = url.searchParams.getAll("order");
  const order = orderValues.length === 0 ? "newest" : orderValues[0];
  if (
    [...url.searchParams.keys()].some((key) => key !== "order") ||
    orderValues.length > 1 ||
    !OPERATION_TELEMETRY_ORDERS.includes(
      order as typeof OPERATION_TELEMETRY_ORDERS[number],
    )
  ) {
    throw new InvalidOperationEventQueryError();
  }
  return order as typeof OPERATION_TELEMETRY_ORDERS[number];
}

async function simulatedEmail(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  await handleAuthorizedRequest(
    request,
    response,
    dependencies,
    () => {
      if (!dependencies.simulatedEmailOperation) {
        throw new Error("Simulated email operation is not configured");
      }
      return dependencies.simulatedEmailOperation.send();
    },
    202,
  );
}

async function helpDeskScenario(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  await handleAuthorizedRequest(
    request,
    response,
    dependencies,
    () => {
      if (!dependencies.helpDeskScenarioOperation) {
        throw new Error("Help desk scenario operation is not configured");
      }
      return dependencies.helpDeskScenarioOperation.send();
    },
    202,
  );
}

async function oneDriveShareProof(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  action: "share" | "remove",
): Promise<void> {
  await handleAuthorizedRequest(
    request,
    response,
    dependencies,
    () => {
      const operation = dependencies.oneDriveShareProofOperation;
      if (!operation) {
        throw new Error("OneDrive share proof is not configured");
      }
      return operation[action]();
    },
    action === "share" ? 201 : 200,
  );
}

type FixedProofOperation =
  | ContactProofOperation
  | InboxRuleProofOperation
  | CategoryProofOperation
  | SharePointFileProofOperation
  | DraftProofOperation
  | TodoTaskProofOperation;

type FixedProofOwnerKey = Extract<
  ApiRouteOwnerKey,
  | `${"contact" | "inbox-rule" | "category" | "sharepoint-file" | "draft" | "todo-task"}-proof-create`
  | `${"contact" | "inbox-rule" | "category" | "sharepoint-file" | "draft" | "todo-task"}-proof-remove`
>;

async function fixedProof(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  ownerKey: FixedProofOwnerKey,
  action: "create" | "remove",
): Promise<void> {
  const operation = fixedProofOperation(dependencies, ownerKey);
  await handleAuthorizedRequest(
    request,
    response,
    dependencies,
    () => {
      if (!operation) {
        throw new Error("Fixed proof operation is not configured");
      }
      return operation[action]();
    },
    action === "create" ? 201 : 200,
  );
}

function fixedProofOperation(
  dependencies: ApiDependencies,
  ownerKey: FixedProofOwnerKey,
): FixedProofOperation | undefined {
  switch (ownerKey) {
    case "contact-proof-create":
    case "contact-proof-remove":
      return dependencies.contactProofOperation;
    case "inbox-rule-proof-create":
    case "inbox-rule-proof-remove":
      return dependencies.inboxRuleProofOperation;
    case "category-proof-create":
    case "category-proof-remove":
      return dependencies.categoryProofOperation;
    case "sharepoint-file-proof-create":
    case "sharepoint-file-proof-remove":
      return dependencies.sharePointFileProofOperation;
    case "draft-proof-create":
    case "draft-proof-remove":
      return dependencies.draftProofOperation;
    case "todo-task-proof-create":
    case "todo-task-proof-remove":
      return dependencies.todoTaskProofOperation;
    default:
      return assertNeverOwner(ownerKey);
  }
}

async function calendarMeeting(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  action: "create" | "cancel",
): Promise<void> {
  await handleAuthorizedRequest(
    request,
    response,
    dependencies,
    () => {
      const operation = dependencies.calendarMeetingOperation;
      if (!operation) {
        throw new Error("Calendar meeting operation is not configured");
      }
      return operation[action]();
    },
    action === "create" ? 201 : 202,
  );
}

async function handleAuthorizedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  operation: (caller: AuthorizedCaller) => unknown | Promise<unknown>,
  successStatus = 200,
): Promise<void> {
  const token = readBearerToken(request.headers.authorization);
  if (!token) {
    sendUnauthorized(response);
    return;
  }

  try {
    const claims = await dependencies.tokenVerifier.verify(token);
    const caller = authorizeClaims(claims, dependencies.callerPolicy);
    sendJson(response, successStatus, await operation(caller));
  } catch (error) {
    if (error instanceof CallerNotAllowedError) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (error instanceof InvalidTokenError || error instanceof InvalidClaimsError) {
      sendUnauthorized(response);
      return;
    }
    if (error instanceof InvalidOperationEventQueryError) {
      sendJson(response, 400, { error: "invalid_operation_event_query" });
      return;
    }
    if (error instanceof JsonUnsupportedMediaTypeError) {
      sendJson(response, 415, { error: "unsupported_media_type" });
      return;
    }
    if (error instanceof JsonRequestTooLargeError) {
      sendJson(response, 413, { error: "request_too_large" });
      return;
    }
    if (error instanceof JsonInvalidBodyError) {
      sendJson(response, 400, { error: "invalid_request_body" });
      return;
    }
    if (error instanceof ScenarioPlanError) {
      sendJson(response, 400, {
        error: "scenario_plan_refused",
        category: error.category,
      });
      return;
    }
    if (
      error instanceof ScenarioPlanSafeFailureError ||
      error instanceof ScenarioPlanResponseTooLargeError
    ) {
      sendJson(response, 500, { error: "scenario_plan_failed" });
      return;
    }
    if (error instanceof EvidenceReceiptError) {
      sendJson(response, 400, {
        error: "scenario_evidence_receipt_refused",
        category: error.code,
      });
      return;
    }
    if (
      error instanceof ScenarioEvidenceVerificationResponseTooLargeError
    ) {
      sendJson(response, 500, {
        error: "scenario_evidence_receipt_response_too_large",
      });
      return;
    }
    if (error instanceof ScenarioEvidenceVerificationSafeFailureError) {
      sendJson(response, 500, {
        error: "scenario_evidence_receipt_failed",
      });
      return;
    }
    if (error instanceof RehearsalOutputVerificationError) {
      sendJson(response, 400, {
        error: "rehearsal_output_refused",
        category: error.category,
      });
      return;
    }
    if (error instanceof RehearsalOutputVerificationResponseTooLargeError) {
      sendJson(response, 500, {
        error: "rehearsal_output_response_too_large",
      });
      return;
    }
    if (error instanceof RehearsalOutputVerificationSafeFailureError) {
      sendJson(response, 500, {
        error: "rehearsal_output_verification_failed",
      });
      return;
    }
    if (
      error instanceof PrivateDocumentRehearsalVerificationError ||
      error instanceof PrivateDocumentRehearsalContractError
    ) {
      sendJson(response, 400, {
        error: "private_document_rehearsal_refused",
        category: error.category,
      });
      return;
    }
    if (
      error instanceof
        PrivateDocumentRehearsalVerificationResponseTooLargeError
    ) {
      sendJson(response, 500, {
        error: "private_document_rehearsal_response_too_large",
      });
      return;
    }
    if (
      error instanceof PrivateDocumentRehearsalVerificationSafeFailureError
    ) {
      sendJson(response, 500, {
        error: "private_document_rehearsal_verification_failed",
      });
      return;
    }
    if (
      error instanceof HelpDeskEmailRehearsalVerificationError ||
      error instanceof HelpDeskEmailRehearsalContractError
    ) {
      sendJson(response, 400, {
        error: "help_desk_email_rehearsal_refused",
        category: error.category,
      });
      return;
    }
    if (
      error instanceof TeamsMissedCallRehearsalVerificationError ||
      error instanceof TeamsMissedCallRehearsalContractError
    ) {
      sendJson(response, 400, {
        error: "teams_missed_call_rehearsal_refused",
        category: error.category,
      });
      return;
    }
    if (
      error instanceof HelpDeskEmailRehearsalVerificationResponseTooLargeError
    ) {
      sendJson(response, 500, {
        error: "help_desk_email_rehearsal_response_too_large",
      });
      return;
    }
    if (
      error instanceof
        TeamsMissedCallRehearsalVerificationResponseTooLargeError
    ) {
      sendJson(response, 500, {
        error: "teams_missed_call_rehearsal_response_too_large",
      });
      return;
    }
    if (
      error instanceof HelpDeskEmailRehearsalVerificationSafeFailureError
    ) {
      sendJson(response, 500, {
        error: "help_desk_email_rehearsal_verification_failed",
      });
      return;
    }
    if (
      error instanceof TeamsMissedCallRehearsalVerificationSafeFailureError
    ) {
      sendJson(response, 500, {
        error: "teams_missed_call_rehearsal_verification_failed",
      });
      return;
    }
    if (
      error instanceof OauthApplicationReconRehearsalVerificationError ||
      error instanceof OauthApplicationReconRehearsalContractError
    ) {
      sendJson(response, 400, {
        error: "oauth_application_recon_rehearsal_refused",
        category: error.category,
      });
      return;
    }
    if (
      error instanceof
        OauthApplicationReconRehearsalVerificationResponseTooLargeError
    ) {
      sendJson(response, 500, {
        error: "oauth_application_recon_rehearsal_response_too_large",
      });
      return;
    }
    if (
      error instanceof
        OauthApplicationReconRehearsalVerificationSafeFailureError
    ) {
      sendJson(response, 500, {
        error: "oauth_application_recon_rehearsal_verification_failed",
      });
      return;
    }
    if (error instanceof BatchFeasibilityRefusalError) {
      sendJson(response, 400, {
        error: "batch_feasibility_refused",
        category: error.category,
      });
      return;
    }
    if (error instanceof BatchFeasibilityResponseTooLargeError) {
      sendJson(response, 500, {
        error: "batch_feasibility_response_too_large",
      });
      return;
    }
    if (error instanceof BatchFeasibilitySafeFailureError) {
      sendJson(response, 500, {
        error: "batch_feasibility_failed",
      });
      return;
    }
    if (error instanceof OneDriveProofConflictError) {
      sendJson(response, 409, { error: "proof_state_conflict" });
      return;
    }
    if (error instanceof OneDriveProofBusyError) {
      sendJson(response, 409, { error: "proof_operation_busy" });
      return;
    }
    if (error instanceof OneDriveInviteFailureError) {
      sendJson(response, 502, {
        error: "onedrive_invite_failed",
        ...error.diagnostic,
      });
      return;
    }
    if (error instanceof CalendarMeetingConflictError) {
      sendJson(response, 409, { error: "calendar_state_conflict" });
      return;
    }
    if (error instanceof CalendarMeetingBusyError) {
      sendJson(response, 409, { error: "calendar_operation_busy" });
      return;
    }
    if (error instanceof ContactProofConflictError) {
      sendJson(response, 409, { error: "contact_state_conflict" });
      return;
    }
    if (error instanceof InboxRuleProofConflictError) {
      sendJson(response, 409, { error: "inbox_rule_state_conflict" });
      return;
    }
    if (error instanceof CategoryProofConflictError) {
      sendJson(response, 409, { error: "category_state_conflict" });
      return;
    }
    if (error instanceof SharePointFileProofConflictError) {
      sendJson(response, 409, { error: "sharepoint_file_state_conflict" });
      return;
    }
    if (error instanceof DraftProofConflictError) {
      sendJson(response, 409, { error: "draft_state_conflict" });
      return;
    }
    if (error instanceof TodoTaskProofConflictError) {
      sendJson(response, 409, { error: "todo_task_state_conflict" });
      return;
    }
    throw error;
  }
}

class JsonUnsupportedMediaTypeError extends Error {}
class JsonRequestTooLargeError extends Error {}
class JsonInvalidBodyError extends Error {}

async function scenarioPlan(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  maximumBytes: number,
): Promise<void> {
  await handleAuthorizedRequest(request, response, dependencies, async () => {
    if (
      request.headers["content-type"] !== "application/json" ||
      request.headers["content-encoding"] !== undefined
    ) {
      throw new JsonUnsupportedMediaTypeError();
    }
    const service = dependencies.scenarioPlanService;
    if (!service) {
      throw new ScenarioPlanSafeFailureError();
    }
    return service.compile(await readBoundedJson(request, maximumBytes));
  });
}

async function scenarioEvidenceVerification(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  maximumBytes: number,
): Promise<void> {
  await handleAuthorizedRequest(request, response, dependencies, async () => {
    if (
      request.headers["content-type"] !== "application/json" ||
      request.headers["content-encoding"] !== undefined
    ) {
      throw new JsonUnsupportedMediaTypeError();
    }
    const service = dependencies.scenarioEvidenceVerificationService;
    if (!service) {
      throw new ScenarioEvidenceVerificationSafeFailureError();
    }
    return service.verify(await readBoundedJson(request, maximumBytes));
  });
}

async function rehearsalOutputVerification(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  maximumBytes: number,
): Promise<void> {
  await handleAuthorizedRequest(request, response, dependencies, async () => {
    if (
      request.headers["content-type"] !== "application/json" ||
      request.headers["content-encoding"] !== undefined
    ) {
      throw new JsonUnsupportedMediaTypeError();
    }
    const service = dependencies.rehearsalOutputVerificationService;
    if (!service) {
      throw new RehearsalOutputVerificationSafeFailureError();
    }
    return service.verify(await readBoundedJson(request, maximumBytes));
  });
}

async function privateDocumentRehearsalVerification(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  maximumBytes: number,
): Promise<void> {
  await handleAuthorizedRequest(request, response, dependencies, async () => {
    if (
      request.headers["content-type"] !== "application/json" ||
      request.headers["content-encoding"] !== undefined
    ) {
      throw new JsonUnsupportedMediaTypeError();
    }
    const service = dependencies.privateDocumentRehearsalVerificationService;
    if (!service) {
      throw new PrivateDocumentRehearsalVerificationSafeFailureError();
    }
    return service.verify(await readBoundedJson(request, maximumBytes));
  });
}

async function helpDeskEmailRehearsalVerification(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  maximumBytes: number,
): Promise<void> {
  await handleAuthorizedRequest(request, response, dependencies, async () => {
    if (
      request.headers["content-type"] !== "application/json" ||
      request.headers["content-encoding"] !== undefined
    ) {
      throw new JsonUnsupportedMediaTypeError();
    }
    const service = dependencies.helpDeskEmailRehearsalVerificationService;
    if (!service) {
      throw new HelpDeskEmailRehearsalVerificationSafeFailureError();
    }
    return service.verify(await readBoundedJson(request, maximumBytes));
  });
}

async function teamsMissedCallRehearsalVerification(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  maximumBytes: number,
): Promise<void> {
  await handleAuthorizedRequest(request, response, dependencies, async () => {
    if (
      request.headers["content-type"] !== "application/json" ||
      request.headers["content-encoding"] !== undefined
    ) {
      throw new JsonUnsupportedMediaTypeError();
    }
    const service = dependencies.teamsMissedCallRehearsalVerificationService;
    if (!service) {
      throw new TeamsMissedCallRehearsalVerificationSafeFailureError();
    }
    return service.verify(await readBoundedJson(request, maximumBytes));
  });
}

async function oauthApplicationReconRehearsalVerification(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  maximumBytes: number,
): Promise<void> {
  await handleAuthorizedRequest(request, response, dependencies, async () => {
    if (
      request.headers["content-type"] !== "application/json" ||
      request.headers["content-encoding"] !== undefined
    ) {
      throw new JsonUnsupportedMediaTypeError();
    }
    const service =
      dependencies.oauthApplicationReconRehearsalVerificationService;
    if (!service) {
      throw new OauthApplicationReconRehearsalVerificationSafeFailureError();
    }
    return service.verify(await readBoundedJson(request, maximumBytes));
  });
}

async function multiScenarioFeasibility(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
  maximumBytes: number,
): Promise<void> {
  await handleAuthorizedRequest(request, response, dependencies, async () => {
    if (
      request.headers["content-type"] !== "application/json" ||
      request.headers["content-encoding"] !== undefined
    ) {
      throw new JsonUnsupportedMediaTypeError();
    }
    const service = dependencies.multiScenarioFeasibilityService;
    if (!service) {
      throw new BatchFeasibilitySafeFailureError();
    }
    return service.calculate(await readBoundedJson(request, maximumBytes));
  });
}

async function readBoundedJson(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<unknown> {
  const contentLength = request.headers["content-length"];
  if (
    contentLength !== undefined &&
    (!/^(0|[1-9][0-9]*)$/.test(contentLength) ||
      Number(contentLength) > maximumBytes)
  ) {
    throw new JsonRequestTooLargeError();
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maximumBytes) {
      request.resume();
      throw new JsonRequestTooLargeError();
    }
    chunks.push(buffer);
  }
  if (totalBytes === 0) {
    throw new JsonInvalidBodyError();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new JsonInvalidBodyError();
  }
}

function readBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
  return match?.[1];
}

function sendUnauthorized(response: ServerResponse): void {
  response.setHeader("WWW-Authenticate", "Bearer");
  sendJson(response, 401, { error: "unauthorized" });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  const routeContract = responseRouteContracts.get(response);
  const maximumBytes = status >= 400
    ? routeContract?.errorMaxBytes
    : routeContract?.responseMaxBytes;
  const serialized = JSON.stringify(body);
  let payload = serialized ?? JSON.stringify({ error: "invalid_response" });
  if (serialized === undefined) status = 500;
  if (
    maximumBytes !== undefined &&
    Buffer.byteLength(payload, "utf8") > maximumBytes
  ) {
    const wasError = status >= 400;
    status = 500;
    payload = JSON.stringify({
      error: wasError ? "error_response_too_large" : "response_too_large",
    });
  }
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload, "utf8"),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(payload);
}

function assertNeverOwner(value: never): never {
  throw new Error(`Unhandled API route owner: ${String(value)}`);
}
