import { realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ClientCertificateCredential } from "@azure/identity";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const GRAPH_APPLICATION_SCOPE = "https://graph.microsoft.com/.default";
const CORY_OBJECT_ID = "1d102db5-eea8-48f0-9074-8a4847384770";
const SHAREPOINT_DRIVE_ID =
  "b!cwlHh29-hku7ujsOQjtYrJgMdCJB4uxPjCIGTA7Dne3i9BWF2f9zS6QFr8wTSu0Z";
const COLLECTION_LIMIT = 25;

interface GraphCredential {
  getToken(scope: string): Promise<{ token: string } | null>;
}

type CollectionObservation = {
  observed: true;
  count: number;
  truncated: boolean;
};

type RootObservation = {
  observed: true;
};

export interface OauthAppReconPreview {
  schemaVersion: 1;
  scenario: "oauth-application-reconnaissance";
  actor: "development-automation-app";
  observedAt: string;
  steps: {
    coryDirectoryMemberships: CollectionObservation;
    coryMailboxFolders: CollectionObservation;
    coryOneDriveRoot: RootObservation;
    sharePointDriveRoot: RootObservation;
  };
  completedSteps: 4;
}

export async function previewOauthAppRecon(
  credential: GraphCredential,
  request: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<OauthAppReconPreview> {
  const access = await credential.getToken(GRAPH_APPLICATION_SCOPE);
  if (!access?.token) {
    throw new Error("Microsoft Entra returned no Microsoft Graph access token.");
  }
  const headers = { Authorization: `Bearer ${access.token}` };

  const coryDirectoryMemberships = await observeCollection(
    collectionUrl(
      `${GRAPH_ROOT}/users/${encodeURIComponent(CORY_OBJECT_ID)}/memberOf`,
    ),
    headers,
    request,
    "directory memberships",
  );
  const coryMailboxFolders = await observeCollection(
    collectionUrl(
      `${GRAPH_ROOT}/users/${encodeURIComponent(CORY_OBJECT_ID)}/mailFolders`,
    ),
    headers,
    request,
    "mailbox folders",
  );
  await observeRoot(
    rootUrl(
      `${GRAPH_ROOT}/users/${encodeURIComponent(CORY_OBJECT_ID)}/drive/root`,
    ),
    headers,
    request,
    "OneDrive root",
  );
  await observeRoot(
    rootUrl(
      `${GRAPH_ROOT}/drives/${encodeURIComponent(SHAREPOINT_DRIVE_ID)}/root`,
    ),
    headers,
    request,
    "SharePoint drive root",
  );

  return {
    schemaVersion: 1,
    scenario: "oauth-application-reconnaissance",
    actor: "development-automation-app",
    observedAt: new Date(nowMs).toISOString(),
    steps: {
      coryDirectoryMemberships,
      coryMailboxFolders,
      coryOneDriveRoot: { observed: true },
      sharePointDriveRoot: { observed: true },
    },
    completedSteps: 4,
  };
}

function collectionUrl(base: string): URL {
  const url = new URL(base);
  url.searchParams.set("$select", "id");
  url.searchParams.set("$top", String(COLLECTION_LIMIT));
  return url;
}

function rootUrl(base: string): URL {
  const url = new URL(base);
  url.searchParams.set("$select", "id,name,folder");
  return url;
}

async function observeCollection(
  url: URL,
  headers: Record<string, string>,
  request: typeof fetch,
  label: string,
): Promise<CollectionObservation> {
  const response = await request(url, {
    method: "GET",
    redirect: "error",
    headers,
  });
  const body = await readJson(response);
  if (
    response.status !== 200 ||
    !isRecord(body) ||
    !Array.isArray(body.value) ||
    body.value.length > COLLECTION_LIMIT ||
    !body.value.every(isIdentifiable)
  ) {
    throw new Error(
      `Microsoft Graph ${label} observation failed with HTTP ${response.status}.`,
    );
  }
  const nextLink = body["@odata.nextLink"];
  if (nextLink !== undefined && typeof nextLink !== "string") {
    throw new Error(`Microsoft Graph ${label} pagination was malformed.`);
  }
  return {
    observed: true,
    count: body.value.length,
    truncated: typeof nextLink === "string",
  };
}

async function observeRoot(
  url: URL,
  headers: Record<string, string>,
  request: typeof fetch,
  label: string,
): Promise<void> {
  const response = await request(url, {
    method: "GET",
    redirect: "error",
    headers,
  });
  const body = await readJson(response);
  if (
    response.status !== 200 ||
    !isIdentifiable(body) ||
    typeof body.name !== "string" ||
    !isRecord(body.folder)
  ) {
    throw new Error(
      `Microsoft Graph ${label} observation failed with HTTP ${response.status}.`,
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifiable(
  value: unknown,
): value is Record<string, unknown> & { id: string } {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0;
}

function secureCertificatePath(configured: string | undefined): string {
  if (!configured) {
    throw new Error("AP2_AUTOMATION_CERTIFICATE_PATH is required.");
  }
  const path = realpathSync(configured);
  if ((statSync(path).mode & 0o077) !== 0) {
    throw new Error(
      "Automation certificate must not be accessible by group or others.",
    );
  }
  return path;
}

async function main(): Promise<void> {
  const credential = new ClientCertificateCredential(
    STUDENT_TENANT_ID,
    DEVELOPMENT_AUTOMATION_CLIENT_ID,
    secureCertificatePath(process.env.AP2_AUTOMATION_CERTIFICATE_PATH),
  );
  console.log(JSON.stringify(await previewOauthAppRecon(credential), null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "OAuth application reconnaissance preview failed.",
    );
    process.exitCode = 1;
  });
}
