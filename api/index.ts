import { ManagedIdentityCredential } from "@azure/identity";
import { loadApiConfig } from "./config.js";
import { AzureRehearsalStatusProvider } from "./rehearsal-status.js";
import { createApiServer } from "./server.js";
import { createRemoteTokenVerifier } from "./token-verifier.js";

const config = loadApiConfig();
const tokenVerifier = createRemoteTokenVerifier({
  issuer: config.issuer,
  audience: config.audience,
  jwksUrl: config.jwksUrl,
  allowInsecureHttp: config.allowInsecureJwks,
});
const server = createApiServer({
  tokenVerifier,
  callerPolicy: config.callerPolicy,
  rehearsalStatusProvider: new AzureRehearsalStatusProvider(
    new ManagedIdentityCredential(),
  ),
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
