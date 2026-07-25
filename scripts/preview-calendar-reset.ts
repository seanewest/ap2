import { realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { ClientCertificateCredential } from "@azure/identity";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const GRAPH_SCOPE = `${GRAPH_ORIGIN}/.default`;
export const CALENDAR_RESET_RUN_PROPERTY_ID =
  "String {c352ae90-352e-4c3f-8f7c-ab63d2ca32cc} Name AP2RunId";
const AP2_CALENDAR_RUN_ID = /^ap2-calendar-\d{8}-\d{3}$/;
const EVENT_FIELDS = [
  "id", "changeKey", "createdDateTime", "type", "isOrganizer",
  "organizer", "attendees", "isCancelled",
] as const;

export const CALENDAR_RESET_USERS = [
  {
    objectId: "1d102db5-eea8-48f0-9074-8a4847384770",
    userPrincipalName: "cory@corywest.onmicrosoft.com",
  },
  { objectId: "6e54e3a9-7651-4520-a331-047550ae6fca",
    userPrincipalName: "homer.simpson@corywest.onmicrosoft.com" },
  { objectId: "646cb944-5637-4410-bfc6-f338598e5804",
    userPrincipalName: "kobe@corywest.onmicrosoft.com" },
  { objectId: "9b7fc1a3-58a0-4440-8d09-796e4d405acd",
    userPrincipalName: "marge.simpson@corywest.onmicrosoft.com" },
] as const;

export interface AccessTokenCredential {
  getToken(scope: string): Promise<{ token: string } | null>;
}

type EventType = "singleInstance" | "seriesMaster" | "occurrence" | "exception" | "unknown";
type RefusalReason = "already_cancelled" | "attendee_not_allowlisted"
  | "malformed_event" | "missing_ap2_marker" | "organizer_not_allowlisted"
  | "recurring_event";

interface UtcInstant {
  canonical: string;
  ticks100ns: bigint;
}

interface PreviewItem {
  ownerObjectId: string;
  ownerUserPrincipalName: string;
  eventId: string | null;
  changeKey: string | null;
  selection: "selected" | "indeterminate";
  createdDateTime: string | null;
  eventType: EventType;
  isOrganizer: boolean | null;
  classification: "eligible" | "refused";
  refusalReasons: RefusalReason[];
}

export interface CalendarResetPreviewManifest {
  schemaVersion: 1;
  operation: "calendar-reset-preview";
  tenantId: typeof STUDENT_TENANT_ID;
  labConstructedAt: string;
  selectionRule: "createdDateTime >= labConstructedAt";
  users: typeof CALENDAR_RESET_USERS;
  items: PreviewItem[];
}

export function requiredLabConstructedAt(
  value: string,
  nowMs = Date.now(),
): string {
  const instant = utcInstant(value);
  if (!instant) {
    throw new Error("The lab construction timestamp must be an exact UTC timestamp.");
  }
  if (instant.ticks100ns > BigInt(nowMs) * 10_000n) {
    throw new Error("The lab construction timestamp cannot be in the future.");
  }
  return instant.canonical;
}

export async function previewCalendarReset(
  labConstructedAt: string,
  credential: AccessTokenCredential,
  request: typeof fetch = fetch,
): Promise<CalendarResetPreviewManifest> {
  const cutoff = utcInstant(labConstructedAt);
  if (!cutoff) {
    throw new Error("The lab construction timestamp must be an exact UTC timestamp.");
  }
  const accessToken = await credential.getToken(GRAPH_SCOPE);
  if (!accessToken?.token) {
    throw new Error("Microsoft Entra returned no Microsoft Graph access token.");
  }

  const allowlistedUpns = new Set(
    CALENDAR_RESET_USERS.map((user) => user.userPrincipalName),
  );
  const items: PreviewItem[] = [];
  for (const user of CALENDAR_RESET_USERS) {
    items.push(
      ...await previewUser(
        user,
        cutoff,
        allowlistedUpns,
        accessToken.token,
        request,
      ),
    );
  }
  items.sort((left, right) =>
    left.ownerUserPrincipalName.localeCompare(right.ownerUserPrincipalName) ||
    (left.createdDateTime ?? "").localeCompare(right.createdDateTime ?? "") ||
    (left.eventId ?? "").localeCompare(right.eventId ?? ""));

  return {
    schemaVersion: 1,
    operation: "calendar-reset-preview",
    tenantId: STUDENT_TENANT_ID,
    labConstructedAt: cutoff.canonical,
    selectionRule: "createdDateTime >= labConstructedAt",
    users: CALENDAR_RESET_USERS,
    items,
  };
}

async function previewUser(
  user: (typeof CALENDAR_RESET_USERS)[number],
  cutoff: UtcInstant,
  allowlistedUpns: ReadonlySet<string>,
  accessToken: string,
  request: typeof fetch,
): Promise<PreviewItem[]> {
  let url: URL | undefined = eventsUrl(user.objectId);
  const seen = new Set<string>();
  const items: PreviewItem[] = [];
  while (url) {
    if (seen.has(url.href)) {
      throw new Error("Microsoft Graph returned a repeated calendar page.");
    }
    seen.add(url.href);
    const response = await request(url, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status !== 200) {
      throw new Error(`Microsoft Graph calendar preview failed with HTTP ${response.status}.`);
    }
    const page = await graphPage(response);
    for (const value of page.value) {
      const item = classify(value, user, allowlistedUpns, cutoff);
      if (item) {
        items.push(item);
      }
    }
    url = page.nextLink
      ? safeNextLink(page.nextLink, user.objectId)
      : undefined;
  }

  return items;
}

function classify(
  value: unknown,
  owner: (typeof CALENDAR_RESET_USERS)[number],
  allowlistedUpns: ReadonlySet<string>,
  cutoff: UtcInstant,
): PreviewItem | undefined {
  const event = record(value);
  const created = utcInstant(event.createdDateTime);
  if (created && created.ticks100ns < cutoff.ticks100ns) {
    return undefined;
  }
  const eventType = eventTypeOf(event.type);
  const isOrganizer = booleanOrNull(event.isOrganizer);
  const isCancelled = booleanOrNull(event.isCancelled);
  const organizer = recipientAddress(event.organizer);
  const attendees = attendeeAddresses(event.attendees);
  const reasons = new Set<RefusalReason>();

  if (
    !nonEmpty(event.id) ||
    !nonEmpty(event.changeKey) ||
    !created ||
    eventType === "unknown" ||
    isOrganizer === null ||
    isCancelled === null ||
    !organizer ||
    !attendees ||
    (isOrganizer && organizer !== owner.userPrincipalName)
  ) {
    reasons.add("malformed_event");
  }
  if (eventType !== "singleInstance" && eventType !== "unknown") {
    reasons.add("recurring_event");
  }
  if (isCancelled) {
    reasons.add("already_cancelled");
  }
  if (organizer && !allowlistedUpns.has(organizer)) {
    reasons.add("organizer_not_allowlisted");
  }
  const outsiders = attendees
    ? attendees.filter((address) => !allowlistedUpns.has(address)).length
    : null;
  if (outsiders) {
    reasons.add("attendee_not_allowlisted");
  }
  if (!hasAp2CalendarMarker(event.singleValueExtendedProperties)) {
    reasons.add("missing_ap2_marker");
  }

  const refusalReasons = [...reasons].sort();
  return {
    ownerObjectId: owner.objectId,
    ownerUserPrincipalName: owner.userPrincipalName,
    eventId: nonEmpty(event.id) ?? null,
    changeKey: nonEmpty(event.changeKey) ?? null,
    selection: created ? "selected" : "indeterminate",
    createdDateTime: created?.canonical ?? null,
    eventType,
    isOrganizer,
    classification: refusalReasons.length ? "refused" : "eligible",
    refusalReasons,
  };
}

function eventsUrl(objectId: string): URL {
  const url = new URL(`${GRAPH_ORIGIN}/v1.0/users/${objectId}/events`);
  url.searchParams.set("$select", EVENT_FIELDS.join(","));
  url.searchParams.set(
    "$expand",
    `singleValueExtendedProperties($filter=id eq '${CALENDAR_RESET_RUN_PROPERTY_ID}')`,
  );
  url.searchParams.set("$top", "100");
  return url;
}

function safeNextLink(value: string, objectId: string): URL {
  const url = new URL(value);
  if (
    url.origin !== GRAPH_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== `/v1.0/users/${objectId}/events`
  ) {
    throw new Error("Microsoft Graph returned an unsafe calendar next link.");
  }
  return url;
}

async function graphPage(
  response: Response,
): Promise<{ value: unknown[]; nextLink?: string }> {
  const value: unknown = await response.json().catch(() => undefined);
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { value?: unknown }).value)
  ) {
    throw new Error("Microsoft Graph returned a malformed calendar page.");
  }
  const nextLink = (value as { "@odata.nextLink"?: unknown })[
    "@odata.nextLink"
  ];
  if (nextLink !== undefined && typeof nextLink !== "string") {
    throw new Error("Microsoft Graph returned a malformed calendar page.");
  }
  return { value: (value as { value: unknown[] }).value, nextLink };
}

export function writeProtectedManifest(
  outputPath: string,
  manifest: CalendarResetPreviewManifest,
  repositoryPath = process.cwd(),
): string {
  if (!isAbsolute(outputPath)) {
    throw new Error("The preview output path must be absolute.");
  }
  const parent = realpathSync(dirname(outputPath));
  const target = join(parent, basename(outputPath));
  const repository = realpathSync(repositoryPath);
  const fromRepository = relative(repository, target);
  if (!fromRepository.startsWith("..") && !isAbsolute(fromRepository)) {
    throw new Error("The preview output must be outside the repository.");
  }
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return target;
}

function utcInstant(value: unknown): UtcInstant | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?Z$/
      .exec(value);
  if (!match?.[1]) {
    return undefined;
  }
  const wholeSecondMs = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(wholeSecondMs)) {
    return undefined;
  }
  const fraction = match[2];
  const fractionalTicks = fraction
    ? BigInt(fraction.padEnd(7, "0"))
    : 0n;
  return {
    canonical: fraction
      ? `${match[1]}.${fraction}Z`
      : new Date(wholeSecondMs).toISOString(),
    ticks100ns: BigInt(wholeSecondMs) * 10_000n + fractionalTicks,
  };
}

function hasAp2CalendarMarker(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) {
    return false;
  }
  const property = record(value[0]);
  return (
    property.id === CALENDAR_RESET_RUN_PROPERTY_ID &&
    typeof property.value === "string" &&
    AP2_CALENDAR_RUN_ID.test(property.value)
  );
}

function eventTypeOf(value: unknown): EventType {
  return value === "singleInstance" ||
    value === "seriesMaster" ||
    value === "occurrence" ||
    value === "exception"
    ? value
    : "unknown";
}

function recipientAddress(value: unknown): string | undefined {
  const emailAddress = record(record(value).emailAddress);
  return typeof emailAddress.address === "string" &&
    /^[^\s@]+@[^\s@]+$/.test(emailAddress.address)
    ? emailAddress.address.toLowerCase()
    : undefined;
}

function attendeeAddresses(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const addresses = value.map((attendee) => {
    const emailAddress = record(record(attendee).emailAddress);
    return typeof emailAddress.address === "string" &&
      /^[^\s@]+@[^\s@]+$/.test(emailAddress.address)
      ? emailAddress.address.toLowerCase()
      : undefined;
  });
  return addresses.every(
    (address): address is string => address !== undefined,
  )
    ? addresses
    : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function argumentsFrom(args: readonly string[]): {
  labConstructedAt: string;
  outputPath: string;
} {
  if (
    args.length !== 4 ||
    args[0] !== "--lab-constructed-at" ||
    !args[1] ||
    args[2] !== "--output" ||
    !args[3]
  ) {
    throw new Error(
      "Usage: --lab-constructed-at <UTC timestamp> --output <absolute path>",
    );
  }
  return {
    labConstructedAt: requiredLabConstructedAt(args[1]),
    outputPath: args[3],
  };
}

function secureCertificatePath(configured: string | undefined): string {
  if (!configured) {
    throw new Error("AP2_AUTOMATION_CERTIFICATE_PATH is required.");
  }
  const path = realpathSync(configured);
  if ((statSync(path).mode & 0o077) !== 0) {
    throw new Error("Automation certificate permissions are too broad.");
  }
  return path;
}

async function main(): Promise<void> {
  const options = argumentsFrom(process.argv.slice(2));
  const credential = new ClientCertificateCredential(
    STUDENT_TENANT_ID,
    DEVELOPMENT_AUTOMATION_CLIENT_ID,
    secureCertificatePath(process.env.AP2_AUTOMATION_CERTIFICATE_PATH),
  );
  const manifest = await previewCalendarReset(
    options.labConstructedAt,
    credential,
  );
  const path = writeProtectedManifest(options.outputPath, manifest);
  console.log(
    `Calendar reset preview wrote ${manifest.items.length} selected or indeterminate events to ${path}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Calendar reset preview failed.",
    );
    process.exitCode = 1;
  });
}
