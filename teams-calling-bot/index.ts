import { ClientCertificateCredential } from "@azure/identity";
import { loadCallingBotConfig } from "./config.js";
import {
  CallingCanary,
  type AppTokenProvider,
} from "./call-canary.js";
import { createMicrosoftCallbackTokenVerifier } from "./callback-auth.js";
import { ExclusiveReducedJournal } from "./journal.js";
import { createCallingBotServer } from "./server.js";

class SingleAppTokenProvider implements AppTokenProvider {
  #called = false;

  constructor(
    private readonly credential: ClientCertificateCredential,
  ) {}

  async getToken(): Promise<string> {
    if (this.#called) throw new Error("Token acquisition already attempted.");
    this.#called = true;
    const result = await this.credential.getToken(
      "https://graph.microsoft.com/.default",
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
  const journal = config.runCanary
    ? ExclusiveReducedJournal.open(
        config.journalPath,
        config.runMarker,
        CallingCanary.requestDigest(settings),
      )
    : undefined;
  const canary = journal
    ? new CallingCanary(
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
      )
    : undefined;
  const server = createCallingBotServer({
    tokenVerifier: verifier,
    canary: canary ?? {
      handleNotificationEnvelope: () => "rejected",
    },
  });

  server.listen(config.port, config.host, () => {
    process.stdout.write("Teams calling canary service is ready.\n");
    if (canary) {
      void canary.run().then((result) => {
        process.stdout.write(
          `Teams calling canary completed with ${result.outcome}.\n`,
        );
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
    process.stdout.write(`Received ${signal}; shutting down.\n`);
    const forcedExit = setTimeout(() => process.exit(1), 10_000);
    forcedExit.unref();
    try {
      await canary?.shutdown();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
    } finally {
      journal?.close();
      clearTimeout(forcedExit);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(() => {
  process.stderr.write("Teams calling canary failed to start safely.\n");
  process.exitCode = 1;
});
