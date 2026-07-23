import { loadApiConfig } from "./config.js";
import { RemoteJwksSigningKeyProvider } from "./jwks.js";
import { JwtVerifier } from "./jwt-verifier.js";
import { createApiServer } from "./server.js";

const config = loadApiConfig();
const signingKeys = new RemoteJwksSigningKeyProvider(config.jwksUrl, {
  allowInsecureHttp: config.allowInsecureJwks,
});
const jwtVerifier = new JwtVerifier({
  issuer: config.issuer,
  audience: config.audience,
  signingKeys,
});
const server = createApiServer({
  jwtVerifier,
  callerPolicy: config.callerPolicy,
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
