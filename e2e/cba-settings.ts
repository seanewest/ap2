import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { STUDENT_TENANT_ID } from "../api/identity";

export { STUDENT_TENANT_ID };
export const STUDENT_OPERATOR =
  "after-party-operator@corywest.onmicrosoft.com";
export const LOCAL_APP_URL = "http://localhost:5173/";
export const LOCAL_API_URL = "http://127.0.0.1:3000";
export const FIRST_API_RESPONSE_TIMEOUT_MS = 90_000;

export interface CbaE2eSettings {
  apiBaseUrl: string;
  appUrl: string;
  certificateOrigins: readonly string[];
  outputDirectory: string;
  passphrase: string;
  pfx: Buffer;
}

export function loadCbaE2eSettings(
  environment: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): CbaE2eSettings {
  const pfxPath = required(environment, "AP2_CBA_PFX_PATH");
  const passphrase = required(environment, "AP2_CBA_PFX_PASSPHRASE");
  if (!isAbsolute(pfxPath)) {
    throw new Error("AP2_CBA_PFX_PATH must be an absolute path outside the repository.");
  }
  const absolutePfxPath = realpathSync(pfxPath);
  if (isInside(resolve(projectRoot), absolutePfxPath)) {
    throw new Error("AP2_CBA_PFX_PATH must be outside the repository.");
  }

  const mode = statSync(absolutePfxPath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error("The CBA PFX must not be readable or writable by group or other users.");
  }
  const directoryMode = statSync(dirname(absolutePfxPath)).mode & 0o777;
  if ((directoryMode & 0o077) !== 0) {
    throw new Error("The CBA PFX directory must not be accessible by group or other users.");
  }

  const appUrl = new URL(environment.AP2_E2E_APP_URL ?? LOCAL_APP_URL).toString();
  const apiBaseUrl = validatedApiBaseUrl(
    environment.AP2_E2E_API_BASE_URL ??
      environment.VITE_API_BASE_URL ??
      LOCAL_API_URL,
  );
  const outputDirectory = resolve(
    environment.AP2_PLAYWRIGHT_OUTPUT_DIR ?? "/tmp/ap2-playwright-cba",
  );
  if (isInside(resolve(projectRoot), outputDirectory)) {
    throw new Error("Playwright output must be outside the repository.");
  }

  return {
    apiBaseUrl,
    appUrl,
    certificateOrigins: certificateOrigins(STUDENT_TENANT_ID),
    outputDirectory,
    passphrase,
    pfx: readFileSync(absolutePfxPath),
  };
}

function validatedApiBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "AP2_E2E_API_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

export function certificateOrigins(tenantId: string): readonly string[] {
  return [
    "https://certauth.login.microsoftonline.com",
    `https://t${tenantId}.certauth.login.microsoftonline.com`,
  ];
}

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
