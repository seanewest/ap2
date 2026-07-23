import { ManagedIdentityCredential } from "@azure/identity";
import { loadApiConfig } from "./config.js";
import { AzureRehearsalStatusProvider } from "./rehearsal-status.js";
import { createApiServer } from "./server.js";
import {
  DelegatedGraphOneDriveShareProof,
  GRAPH_FILES_READ_SCOPE,
  GRAPH_FILES_READ_WRITE_SCOPE,
} from "./onedrive-share-proof.js";
import {
  DelegatedGraphSimulatedEmailOperation,
  GRAPH_MAIL_SEND_SCOPE,
} from "./simulated-email.js";
import {
  HOMER_IDENTITY,
  MARGE_DISPLAY_NAME,
  MARGE_USER_PRINCIPAL_NAME,
  type SimulatedUserIdentity,
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
const homerTokenProvider = config.simulatedUsersCba?.homer
  ? new SimulatedUserDelegatedTokenProvider({
      clientId: config.simulatedUsersCba.clientId,
      ...config.simulatedUsersCba.homer,
      identity: HOMER_IDENTITY,
      allowedScopes: [GRAPH_MAIL_SEND_SCOPE, GRAPH_FILES_READ_WRITE_SCOPE],
    })
  : undefined;
const margeIdentity: SimulatedUserIdentity | undefined =
  config.simulatedUsersCba?.marge
    ? {
        tenantId: HOMER_IDENTITY.tenantId,
        objectId: config.simulatedUsersCba.marge.objectId,
        displayName: MARGE_DISPLAY_NAME,
        userPrincipalName: MARGE_USER_PRINCIPAL_NAME,
      }
    : undefined;
const margeTokenProvider =
  config.simulatedUsersCba?.marge && margeIdentity
    ? new SimulatedUserDelegatedTokenProvider({
        clientId: config.simulatedUsersCba.clientId,
        ...config.simulatedUsersCba.marge,
        identity: margeIdentity,
        allowedScopes: [GRAPH_FILES_READ_SCOPE],
      })
    : undefined;
const simulatedEmailOperation = homerTokenProvider
  ? new DelegatedGraphSimulatedEmailOperation(homerTokenProvider)
  : undefined;
const oneDriveShareProofOperation =
  homerTokenProvider && margeTokenProvider && margeIdentity
    ? new DelegatedGraphOneDriveShareProof(
        homerTokenProvider,
        margeTokenProvider,
        margeIdentity,
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
