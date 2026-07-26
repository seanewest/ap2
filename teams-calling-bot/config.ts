import { isAbsolute } from "node:path";

export interface CallingBotConfig {
  host: string;
  port: number;
  tenantId: string;
  appId: string;
  targetUserId: string;
  callbackUri: string;
  certificatePath: string;
  certificatePassword?: string;
  journalPath: string;
  runMarker: string;
  runCanary: boolean;
}

export function loadCallingBotConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CallingBotConfig {
  const callbackUri = required(environment, "TEAMS_CALLING_BOT_CALLBACK_URI");
  const callbackUrl = new URL(callbackUri);
  if (
    callbackUrl.protocol !== "https:" ||
    callbackUrl.username ||
    callbackUrl.password ||
    callbackUrl.pathname !== "/callbacks/calls" ||
    callbackUrl.search ||
    callbackUrl.hash
  ) {
    throw new Error(
      "TEAMS_CALLING_BOT_CALLBACK_URI must be an exact HTTPS /callbacks/calls URL",
    );
  }

  const certificatePath = required(
    environment,
    "TEAMS_CALLING_BOT_CERTIFICATE_PATH",
  );
  const journalPath = required(environment, "TEAMS_CALLING_BOT_JOURNAL_PATH");
  if (!isAbsolute(certificatePath)) {
    throw new Error("TEAMS_CALLING_BOT_CERTIFICATE_PATH must be absolute");
  }
  if (!isAbsolute(journalPath)) {
    throw new Error("TEAMS_CALLING_BOT_JOURNAL_PATH must be absolute");
  }

  const tenantId = uuid(environment, "TEAMS_CALLING_BOT_TENANT_ID");
  const appId = uuid(environment, "TEAMS_CALLING_BOT_APP_ID");
  const targetUserId = uuid(environment, "TEAMS_CALLING_BOT_TARGET_USER_ID");
  const runMarker = required(environment, "TEAMS_CALLING_BOT_RUN_MARKER");
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(runMarker)) {
    throw new Error(
      "TEAMS_CALLING_BOT_RUN_MARKER must use 1-100 safe label characters",
    );
  }
  const runCanaryValue = environment.TEAMS_CALLING_BOT_RUN_CANARY ?? "false";
  if (runCanaryValue !== "true" && runCanaryValue !== "false") {
    throw new Error("TEAMS_CALLING_BOT_RUN_CANARY must be true or false");
  }

  return {
    host: environment.HOST ?? "0.0.0.0",
    port: parsePort(environment.PORT ?? "3001"),
    tenantId,
    appId,
    targetUserId,
    callbackUri: callbackUrl.toString(),
    certificatePath,
    ...(environment.TEAMS_CALLING_BOT_CERTIFICATE_PASSWORD
      ? {
          certificatePassword:
            environment.TEAMS_CALLING_BOT_CERTIFICATE_PASSWORD,
        }
      : {}),
    journalPath,
    runMarker,
    runCanary: runCanaryValue === "true",
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function uuid(environment: NodeJS.ProcessEnv, name: string): string {
  const value = required(environment, name);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  ) {
    throw new Error(`${name} must be a UUID`);
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  return port;
}
