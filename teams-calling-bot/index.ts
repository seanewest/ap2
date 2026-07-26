import { ClientCertificateCredential } from "@azure/identity";
import { loadCallingBotConfig } from "./config.js";
import {
  CallingCanary,
  type AppTokenProvider,
} from "./call-canary.js";
import { createMicrosoftCallbackTokenVerifier } from "./callback-auth.js";
import { ExclusiveReducedJournal } from "./journal.js";
import { createCallingBotServer } from "./server.js";
import { dispatchAfterExactPublicRevision } from "./startup-gate.js";

class SingleAppTokenProvider implements AppTokenProvider {
  #called = false;

  constructor(
    private readonly credential: ClientCertificateCredential,
  ) {}

  async getToken(signal?: AbortSignal): Promise<string> {
    if (this.#called) throw new Error("Token acquisition already attempted.");
    this.#called = true;
    const result = await this.credential.getToken(
      "https://graph.microsoft.com/.default",
      { abortSignal: signal },
    );
    if (!result?.token) throw new Error("App token is unavailable.");
    return result.token;
  }
}

async function main(): Promise<void> {
  const config = loadCallingBotConfig();
  const verifier = await createMicrosoftCallbackTokenVerifier(
    config.tenantId,
    config.appId,
  );
  const settings = {
    targetUserId: config.targetUserId,
    callbackUri: config.callbackUri,
  };
  let journal: ExclusiveReducedJournal | undefined;
  let canary: CallingCanary | undefined;
  const gateAbort = new AbortController();
  const server = createCallingBotServer({
    tokenVerifier: verifier,
    revisionMarker: config.revisionMarker,
    canary: {
      handleNotificationEnvelope: (body, notificationDigest) =>
        canary?.handleNotificationEnvelope(body, notificationDigest) ??
          "rejected",
    },
  });

  server.listen(config.port, config.host, () => {
    process.stdout.write("Teams calling canary service is ready.\n");
    if (config.runCanary) {
      void dispatchAfterExactPublicRevision(
        config.callbackUri,
        config.revisionMarker,
        async () => {
          journal = ExclusiveReducedJournal.open(
            config.journalPath,
            config.runMarker,
            CallingCanary.requestDigest(settings),
          );
          canary = new CallingCanary(
            settings,
            journal,
            new SingleAppTokenProvider(new ClientCertificateCredential(
              config.tenantId,
              config.appId,
              {
                certificatePath: config.certificatePath,
                ...(config.certificatePassword
                  ? { certificatePassword: config.certificatePassword }
                  : {}),
              },
            )),
          );
          const result = await canary.run();
          process.stdout.write(
            `Teams calling canary completed with ${result.outcome}.\n`,
          );
        },
        fetch,
        { signal: gateAbort.signal },
      ).then((dispatched) => {
        if (!dispatched) {
          process.stderr.write(
            "Teams calling canary revision gate closed without dispatch.\n",
          );
        }
      }).catch(() => {
        process.stderr.write(
          "Teams calling canary stopped without safe evidence.\n",
        );
      });
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    gateAbort.abort();
    process.stdout.write(`Received ${signal}; shutting down.\n`);
    try {
      await canary?.shutdown();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
    } finally {
      journal?.close();
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(() => {
  process.stderr.write("Teams calling canary failed to start safely.\n");
  process.exitCode = 1;
});
