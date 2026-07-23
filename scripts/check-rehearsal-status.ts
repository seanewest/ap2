import { realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ClientCertificateCredential } from "@azure/identity";
import {
  AFTER_PARTY_CLIENT_ID,
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity.js";
import {
  HttpAfterPartyApi,
  type AfterPartyApi,
  type RehearsalStatus,
} from "../src/api/client.js";
import { resolveApiBaseUrl } from "../src/api/config.js";

export const AUTOMATION_API_SCOPE =
  `api://${AFTER_PARTY_CLIENT_ID}/.default` as const;

export interface ApiTokenCredential {
  getToken(scope: string): Promise<{ token: string } | null>;
}

export async function checkRehearsalStatus(
  credential: ApiTokenCredential,
  api: Pick<AfterPartyApi, "getRehearsalStatus">,
): Promise<RehearsalStatus> {
  const accessToken = await credential.getToken(AUTOMATION_API_SCOPE);
  if (!accessToken) {
    throw new Error("Microsoft Entra returned no API access token");
  }
  return api.getRehearsalStatus(accessToken.token);
}

async function main(): Promise<void> {
  const certificatePath = secureCertificatePath(
    process.env.AP2_AUTOMATION_CERTIFICATE_PATH,
  );
  const apiBaseUrl = requiredApiBaseUrl(process.env.AP2_API_BASE_URL);
  const credential = new ClientCertificateCredential(
    STUDENT_TENANT_ID,
    DEVELOPMENT_AUTOMATION_CLIENT_ID,
    certificatePath,
  );
  const status = await checkRehearsalStatus(
    credential,
    new HttpAfterPartyApi(apiBaseUrl),
  );
  console.log(JSON.stringify(status, null, 2));
}

function requiredApiBaseUrl(configuredUrl: string | undefined): string {
  if (!configuredUrl?.trim()) {
    throw new Error("AP2_API_BASE_URL is required");
  }
  return resolveApiBaseUrl(configuredUrl);
}

function secureCertificatePath(configuredPath: string | undefined): string {
  if (!configuredPath) {
    throw new Error("AP2_AUTOMATION_CERTIFICATE_PATH is required");
  }
  const path = realpathSync(configuredPath);
  if ((statSync(path).mode & 0o077) !== 0) {
    throw new Error(
      "Automation certificate must not be accessible by group or others",
    );
  }
  return path;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Status check failed");
    process.exitCode = 1;
  });
}
