import { ManagedIdentityCredential } from "@azure/identity";
import {
  CALENDAR_MEETING_RUN_ID,
  DelegatedGraphCalendarMeetingOperation,
  GRAPH_CALENDARS_READ_WRITE_SCOPE,
  ProcessLocalCalendarMeetingBoundary,
} from "./calendar-meeting.js";
import {
  BestEffortOperationTelemetrySink,
  OperationTelemetry,
  StructuredConsoleOperationTelemetrySink,
} from "./operation-telemetry.js";
import { InMemoryOperationTelemetryCollector } from "./operation-telemetry-collector.js";
import { DelegatedGraphCategoryProof } from "./category-proof.js";
import {
  DelegatedGraphContactProof,
  GRAPH_CONTACTS_READ_WRITE_SCOPE,
} from "./contact-proof.js";
import {
  DelegatedGraphInboxRuleProof,
  GRAPH_MAILBOX_SETTINGS_READ_WRITE_SCOPE,
} from "./inbox-rule-proof.js";
import {
  DelegatedGraphDraftProof,
  GRAPH_MAIL_READ_WRITE_SCOPE,
} from "./draft-proof.js";
import {
  DelegatedGraphTodoTaskProof,
  GRAPH_TASKS_READ_WRITE_SCOPE,
} from "./todo-task-proof.js";
import { loadApiConfig } from "./config.js";
import { AzureRehearsalStatusProvider } from "./rehearsal-status.js";
import { GraphSharePointFileProof } from "./sharepoint-file-proof.js";
import { createApiServer } from "./server.js";
import {
  DelegatedGraphOneDriveShareProof,
  GRAPH_FILES_READ_WRITE_SCOPE,
  ProcessLocalOneDriveShareProofBoundary,
} from "./onedrive-share-proof.js";
import {
  DelegatedGraphSimulatedEmailOperation,
  GRAPH_MAIL_SEND_SCOPE,
} from "./simulated-email.js";
import { DelegatedGraphHelpDeskScenarioOperation } from "./help-desk-scenario.js";
import {
  coryIdentity,
  HOMER_IDENTITY,
  KOBE_IDENTITY,
} from "./simulated-user.js";
import { SimulatedUserDelegatedTokenProvider } from "./simulated-user-cba.js";
import { createRemoteTokenVerifier } from "./token-verifier.js";

const config = loadApiConfig();
const tokenVerifier = createRemoteTokenVerifier({
  issuer: config.issuer,
  audience: config.audience,
  jwksUrl: config.jwksUrl,
  allowInsecureHttp: config.allowInsecureJwks,
});
const homerConfig = config.simulatedUsersCba?.homer;
const homerTokenProvider = config.simulatedUsersCba && homerConfig
  ? new SimulatedUserDelegatedTokenProvider({
      clientId: config.simulatedUsersCba.clientId,
      ...homerConfig,
      identity: HOMER_IDENTITY,
      allowedScopes: [GRAPH_MAIL_SEND_SCOPE, GRAPH_FILES_READ_WRITE_SCOPE],
    })
  : undefined;
const simulatedEmailOperation = homerTokenProvider
  ? new DelegatedGraphSimulatedEmailOperation(homerTokenProvider)
  : undefined;
const kobeConfig = config.simulatedUsersCba?.kobe;
const kobeTokenProvider = config.simulatedUsersCba && kobeConfig
  ? new SimulatedUserDelegatedTokenProvider({
      clientId: config.simulatedUsersCba.clientId,
      ...kobeConfig,
      identity: KOBE_IDENTITY,
      allowedScopes: [GRAPH_MAIL_SEND_SCOPE],
    })
  : undefined;
const helpDeskScenarioOperation = kobeTokenProvider
  ? new DelegatedGraphHelpDeskScenarioOperation(kobeTokenProvider)
  : undefined;
const oneDriveShareProofOperation =
  homerTokenProvider
    ? new ProcessLocalOneDriveShareProofBoundary(
        new DelegatedGraphOneDriveShareProof(homerTokenProvider),
      )
    : undefined;
const coryConfig = config.simulatedUsersCba?.cory;
const cory = coryConfig
  ? coryIdentity(coryConfig.objectId)
  : undefined;
const coryTokenProvider =
  config.simulatedUsersCba && coryConfig && cory
    ? new SimulatedUserDelegatedTokenProvider({
        clientId: config.simulatedUsersCba.clientId,
        pfxPath: coryConfig.pfxPath,
        pfxPassphrase: coryConfig.pfxPassphrase,
        identity: cory,
        allowedScopes: [
          GRAPH_CALENDARS_READ_WRITE_SCOPE,
          GRAPH_CONTACTS_READ_WRITE_SCOPE,
          GRAPH_MAILBOX_SETTINGS_READ_WRITE_SCOPE,
          GRAPH_MAIL_READ_WRITE_SCOPE,
          GRAPH_TASKS_READ_WRITE_SCOPE,
        ],
      })
    : undefined;
const operationTelemetryCollector =
  new InMemoryOperationTelemetryCollector();
const calendarMeetingOperation =
  coryTokenProvider && cory
    ? new ProcessLocalCalendarMeetingBoundary(
        new DelegatedGraphCalendarMeetingOperation(
          coryTokenProvider,
          cory,
          fetch,
          new OperationTelemetry(
            CALENDAR_MEETING_RUN_ID,
            new BestEffortOperationTelemetrySink(
              new StructuredConsoleOperationTelemetrySink(),
              operationTelemetryCollector,
            ),
          ),
        ),
      )
    : undefined;
const contactProofOperation =
  coryTokenProvider && cory
    ? new DelegatedGraphContactProof(coryTokenProvider, cory)
    : undefined;
const inboxRuleProofOperation =
  coryTokenProvider && cory
    ? new DelegatedGraphInboxRuleProof(coryTokenProvider, cory)
    : undefined;
const categoryProofOperation =
  coryTokenProvider && cory
    ? new DelegatedGraphCategoryProof(coryTokenProvider, cory)
    : undefined;
const draftProofOperation =
  coryTokenProvider && cory
    ? new DelegatedGraphDraftProof(coryTokenProvider, cory)
    : undefined;
const todoTaskProofOperation =
  coryTokenProvider && cory
    ? new DelegatedGraphTodoTaskProof(coryTokenProvider, cory)
    : undefined;
const managedIdentity = new ManagedIdentityCredential();
const server = createApiServer({
  tokenVerifier,
  callerPolicy: config.callerPolicy,
  rehearsalStatusProvider: new AzureRehearsalStatusProvider(managedIdentity),
  simulatedEmailOperation,
  helpDeskScenarioOperation,
  oneDriveShareProofOperation,
  calendarMeetingOperation,
  contactProofOperation,
  inboxRuleProofOperation,
  categoryProofOperation,
  draftProofOperation,
  todoTaskProofOperation,
  operationTelemetryReader: operationTelemetryCollector,
  sharePointFileProofOperation: new GraphSharePointFileProof(managedIdentity),
  allowedOrigin: config.allowedOrigin,
});

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  console.log(`AP2 API listening on ${config.host}:${port}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down`);

  const forcedExit = setTimeout(() => {
    console.error("API shutdown timed out");
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  server.close((error) => {
    clearTimeout(forcedExit);
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
  server.closeIdleConnections();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
