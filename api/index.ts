import { ManagedIdentityCredential } from "@azure/identity";
import {
  DelegatedGraphCalendarMeetingOperation,
  GRAPH_CALENDARS_READ_WRITE_SCOPE,
  ProcessLocalCalendarMeetingBoundary,
} from "./calendar-meeting.js";
import { loadApiConfig } from "./config.js";
import { AzureRehearsalStatusProvider } from "./rehearsal-status.js";
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
import {
  coryIdentity,
  HOMER_IDENTITY,
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
const homerTokenProvider = config.simulatedUsersCba
  ? new SimulatedUserDelegatedTokenProvider({
      clientId: config.simulatedUsersCba.clientId,
      ...config.simulatedUsersCba.homer,
      identity: HOMER_IDENTITY,
      allowedScopes: [GRAPH_MAIL_SEND_SCOPE, GRAPH_FILES_READ_WRITE_SCOPE],
    })
  : undefined;
const simulatedEmailOperation = homerTokenProvider
  ? new DelegatedGraphSimulatedEmailOperation(homerTokenProvider)
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
        allowedScopes: [GRAPH_CALENDARS_READ_WRITE_SCOPE],
      })
    : undefined;
const calendarMeetingOperation =
  coryTokenProvider && cory
    ? new ProcessLocalCalendarMeetingBoundary(
        new DelegatedGraphCalendarMeetingOperation(coryTokenProvider, cory),
      )
    : undefined;
const server = createApiServer({
  tokenVerifier,
  callerPolicy: config.callerPolicy,
  rehearsalStatusProvider: new AzureRehearsalStatusProvider(
    new ManagedIdentityCredential(),
  ),
  simulatedEmailOperation,
  oneDriveShareProofOperation,
  calendarMeetingOperation,
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
