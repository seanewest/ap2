import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { STUDENT_TENANT_ID } from "../api/identity";

export { STUDENT_TENANT_ID };
export const STUDENT_OPERATOR =
  "after-party-operator@corywest.onmicrosoft.com";
export const LOCAL_APP_URL = "http://localhost:5173/";
export const LOCAL_API_URL = "http://127.0.0.1:3000";
export const FIRST_API_RESPONSE_TIMEOUT_MS = 90_000;
const PAGES_APP_ORIGIN = "https://seanewest.github.io";
const PAGES_APP_PATH = "/ap2/";

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

  const appUrl = validatedAppUrl(
    environment.AP2_E2E_APP_URL ?? LOCAL_APP_URL,
  );
  const apiBaseUrl = validatedApiBaseUrl(
    environment.AP2_E2E_API_BASE_URL ??
      environment.VITE_API_BASE_URL ??
      LOCAL_API_URL,
  );
  const outputDirectory = validatedExternalOutputDirectory(
    environment.AP2_PLAYWRIGHT_OUTPUT_DIR ?? "/tmp/ap2-playwright-cba",
    projectRoot,
  );

  return {
    apiBaseUrl,
    appUrl,
    certificateOrigins: certificateOrigins(STUDENT_TENANT_ID),
    outputDirectory,
    passphrase,
    pfx: readFileSync(absolutePfxPath),
  };
}

function validatedAppUrl(value: string): string {
  const url = parsedUrl(value, "AP2_E2E_APP_URL");
  const isPagesApp =
    url.origin === PAGES_APP_ORIGIN && url.pathname === PAGES_APP_PATH;
  const isLocalApp =
    isLoopbackHostname(url.hostname) && url.pathname === "/";
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!isPagesApp && !isLocalApp)
  ) {
    throw new Error(
      "AP2_E2E_APP_URL must be the AP2 Pages path or a loopback root URL, using HTTP(S) without credentials, query, or fragment.",
    );
  }
  return url.toString();
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function validatedApiBaseUrl(value: string): string {
  const url = parsedUrl(value, "AP2_E2E_API_BASE_URL");
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

function validatedExternalOutputDirectory(
  value: string,
  projectRoot: string,
): string {
  const outputDirectory = resolve(value);
  const root = parse(outputDirectory).root;
  let existingAncestor = root;
  let current = root;
  for (const segment of relative(root, outputDirectory).split(sep)) {
    if (!segment) {
      continue;
    }
    current = join(current, segment);
    try {
      const metadata = lstatSync(current);
      if (metadata.isSymbolicLink()) {
        throw new Error(
          "Playwright output must not contain symbolic-link components.",
        );
      }
      existingAncestor = current;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        break;
      }
      throw error;
    }
  }

  const canonicalProjectRoot = realpathSync(projectRoot);
  const canonicalCandidate = resolve(
    realpathSync(existingAncestor),
    relative(existingAncestor, outputDirectory),
  );
  if (isInside(canonicalProjectRoot, canonicalCandidate)) {
    throw new Error("Playwright output must be outside the repository.");
  }
  return outputDirectory;
}

function parsedUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }
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
