import { ClientCertificateCredential } from "@azure/identity";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AFTER_PARTY_CLIENT_ID } from "../api/identity.ts";
import { SimulatedUserDelegatedTokenProvider } from "../api/simulated-user-cba.ts";
import {
  HOMER_IDENTITY,
  MARGE_IDENTITY,
  type DelegatedGraphToken,
} from "../api/simulated-user.ts";

/*
 * Recovered from archived W53 / AP2-MARGE-USER-RULE-20260815T1347Z.
 * Safe order: precheck, start-avd, establish Marge's Windows App session, run,
 * cleanup, then finalize-avd. `run` itself rechecks the exact active Marge
 * session, creates and confirms the rule, and makes one send that must not be
 * retried after an ambiguous response.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const MAILBOX_SCOPE = "https://graph.microsoft.com/MailboxSettings.ReadWrite";
const MAIL_SCOPE = "https://graph.microsoft.com/Mail.ReadWrite";
const SEND_SCOPE = "https://graph.microsoft.com/Mail.Send";
const RUN_ID_PATTERN = /^AP2-MARGE-USER-RULE-\d{8}T\d{4}Z$/;
const AVD = {
  resourceGroup: "rg-ap2-avd-img-marge",
  vm: "ap2margefresh-vm",
  hostPool: "ap2imgmarge-hp",
  sessionHost: "ap2margefresh",
} as const;

type JsonRecord = Record<string, unknown>;

export interface ProofMarker {
  runId: string;
  displayName: string;
  subject: string;
}

export interface AvdState {
  observedUtc: string;
  powerState: string | undefined;
  sessionHostStatus: string | undefined;
  declaredSessionCount: number | undefined;
  userSessions: Array<{
    id: string;
    userPrincipalName: string | undefined;
    sessionState: string | undefined;
  }>;
}

interface GraphResult {
  status: number;
  headers: Record<string, string>;
  body: JsonRecord | null;
}

interface Context {
  marker: ProofMarker;
  runtimeRoot: string;
  outputDirectory: string;
  marge: SimulatedUserDelegatedTokenProvider;
  homer: SimulatedUserDelegatedTokenProvider;
}

export function proofMarker(runId: string): ProofMarker {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("AP2_RUN_ID must match AP2-MARGE-USER-RULE-YYYYMMDDTHHMMZ");
  }
  return {
    runId,
    displayName: `AP2 Marge user rule ${runId}`,
    subject: `AP2 harmless Marge rule marker ${runId}`,
  };
}

export function ruleRequest(marker: ProofMarker, sequence: number): JsonRecord {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("The rule sequence must be a positive safe integer");
  }
  return {
    displayName: marker.displayName,
    sequence,
    isEnabled: true,
    conditions: { subjectContains: [marker.subject] },
    actions: { markAsRead: true, stopProcessingRules: false },
  };
}

export function isExactRuleShape(value: unknown, marker: ProofMarker): boolean {
  if (!isRecord(value)) return false;
  const conditions = isRecord(value.conditions) ? value.conditions : {};
  const actions = isRecord(value.actions) ? value.actions : {};
  return value.displayName === marker.displayName &&
    value.isEnabled === true && value.isReadOnly !== true &&
    value.hasError !== true &&
    isSingleString(conditions.subjectContains, marker.subject) &&
    onlyEffectiveKeys(conditions, ["subjectContains"]) &&
    actions.markAsRead === true &&
    (actions.stopProcessingRules === false || actions.stopProcessingRules == null) &&
    onlyEffectiveKeys(actions, ["markAsRead", "stopProcessingRules"]) &&
    isInert(value.exceptions);
}

export function isExactEffectMessage(
  value: unknown,
  marker: ProofMarker,
): boolean {
  if (!isRecord(value)) return false;
  const sender = address(value.sender);
  const recipients = Array.isArray(value.toRecipients)
    ? value.toRecipients.map(address)
    : [];
  return value.subject === marker.subject && value.isRead === true &&
    value.hasAttachments === false &&
    sender === lower(HOMER_IDENTITY.userPrincipalName) &&
    recipients.length === 1 &&
    recipients[0] === lower(MARGE_IDENTITY.userPrincipalName);
}

export function assertActiveMargeSession(state: AvdState): void {
  const session = state.userSessions[0];
  if (
    state.powerState !== "PowerState/running" ||
    state.sessionHostStatus !== "Available" ||
    state.declaredSessionCount !== 1 ||
    state.userSessions.length !== 1 ||
    session?.userPrincipalName?.toLowerCase() !==
      MARGE_IDENTITY.userPrincipalName.toLowerCase() ||
    session.sessionState !== "Active"
  ) {
    throw new Error(`Marge's exact active AVD session is not present: ${JSON.stringify(state)}`);
  }
}

function lower(value: string): string {
  return value.toLowerCase();
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSingleString(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === expected;
}

function isInert(value: unknown): boolean {
  if (value == null || value === false || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.values(value).every(isInert);
}

function onlyEffectiveKeys(value: JsonRecord, allowed: string[]): boolean {
  return Object.entries(value).every(([key, item]) =>
    allowed.includes(key) || isInert(item)
  );
}

function address(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.emailAddress)) return undefined;
  return typeof value.emailAddress.address === "string"
    ? value.emailAddress.address.toLowerCase()
    : undefined;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateRealPath(path: string, kind: "file" | "directory"): string {
  const resolved = realpathSync(path);
  const metadata = statSync(resolved);
  const userId = process.getuid?.();
  if (
    (kind === "file" && !metadata.isFile()) ||
    (kind === "directory" && !metadata.isDirectory()) ||
    (metadata.mode & 0o077) !== 0 || userId === undefined ||
    metadata.uid !== userId
  ) {
    throw new Error(`${path} is not a private, owned ${kind}`);
  }
  return resolved;
}

function createContext(): Context {
  const marker = proofMarker(requiredEnvironment("AP2_RUN_ID"));
  const runtimeRoot = privateRealPath(
    requiredEnvironment("AP2_RUNTIME_ROOT"),
    "directory",
  );
  const runsRoot = privateRealPath(join(runtimeRoot, "runs"), "directory");
  const outputDirectory = join(runsRoot, marker.runId.toLowerCase());
  if (existsSync(outputDirectory)) {
    privateRealPath(outputDirectory, "directory");
  } else {
    mkdirSync(outputDirectory, { recursive: false, mode: 0o700 });
    chmodSync(outputDirectory, 0o700);
  }

  const provider = (
    alias: "marge" | "homer",
    identity: typeof MARGE_IDENTITY,
    scopes: string[],
  ): SimulatedUserDelegatedTokenProvider => {
    const root = privateRealPath(
      join(runtimeRoot, "secrets/cba/users", alias),
      "directory",
    );
    const pfxPath = privateRealPath(join(root, "certificate.pfx"), "file");
    const passphrasePath = privateRealPath(
      join(root, "pfx-passphrase.txt"),
      "file",
    );
    return new SimulatedUserDelegatedTokenProvider({
      clientId: AFTER_PARTY_CLIENT_ID,
      pfxPath,
      pfxPassphrase: readFileSync(passphrasePath, "utf8").trim(),
      identity,
      allowedScopes: scopes,
      timeoutMs: 120_000,
    });
  };

  return {
    marker,
    runtimeRoot,
    outputDirectory,
    marge: provider("marge", MARGE_IDENTITY, [MAILBOX_SCOPE, MAIL_SCOPE]),
    homer: provider("homer", HOMER_IDENTITY, [SEND_SCOPE]),
  };
}

async function graph(
  url: string | URL,
  token: string,
  options: RequestInit = {},
): Promise<GraphResult> {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (body !== null && !isRecord(body)) {
    throw new Error(`Graph returned an unexpected body (HTTP ${response.status})`);
  }
  const headers = Object.fromEntries(
    [...response.headers].filter(([key]) =>
      ["request-id", "client-request-id", "date"].includes(key.toLowerCase())
    ),
  );
  return { status: response.status, headers, body };
}

function values(result: GraphResult, boundary: number, label: string): unknown[] {
  const value = result.body?.value;
  if (
    result.status !== 200 || result.body?.["@odata.nextLink"] ||
    !Array.isArray(value) || value.length > boundary
  ) {
    throw new Error(`Bounded ${label} inventory failed HTTP ${result.status}`);
  }
  return value;
}

async function exactRules(token: string, marker: ProofMarker): Promise<JsonRecord[]> {
  const url = new URL(`${GRAPH}/me/mailFolders/inbox/messageRules`);
  url.searchParams.set("$top", "257");
  return values(await graph(url, token), 256, "rule")
    .filter(isRecord)
    .filter((rule) => rule.displayName === marker.displayName);
}

async function exactMessages(
  token: string,
  marker: ProofMarker,
  inboxOnly: boolean,
): Promise<JsonRecord[]> {
  const collection = inboxOnly ? "me/mailFolders/inbox/messages" : "me/messages";
  const url = new URL(`${GRAPH}/${collection}`);
  url.searchParams.set("$filter", `subject eq '${marker.subject.replaceAll("'", "''")}'`);
  url.searchParams.set(
    "$select",
    "id,parentFolderId,subject,isRead,sender,from,toRecipients,receivedDateTime,createdDateTime,hasAttachments,bodyPreview",
  );
  url.searchParams.set("$top", "10");
  return values(await graph(url, token), 10, "message").filter(isRecord);
}

async function acquireMarge(context: Context): Promise<{
  mailbox: DelegatedGraphToken;
  mail: DelegatedGraphToken;
  identity: DelegatedGraphToken["identity"];
}> {
  const mailbox = await context.marge.getToken(MAILBOX_SCOPE);
  const mail = await context.marge.getToken(MAIL_SCOPE);
  if (!mailbox || !mail) throw new Error("Marge delegated token acquisition failed");
  return { mailbox, mail, identity: mailbox.identity };
}

function writeReceipt(context: Context, name: string, value: unknown): void {
  writeFileSync(
    join(context.outputDirectory, `${name}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function armClient(runtimeRoot: string): Promise<{
  state(): Promise<AvdState>;
  start(): Promise<void>;
  logoff(sessionId: string): Promise<void>;
  deallocate(): Promise<void>;
}> {
  const configPath = privateRealPath(
    join(runtimeRoot, "secrets/dev-graph/config.json"),
    "file",
  );
  const credentialPath = privateRealPath(
    join(runtimeRoot, "secrets/dev-graph/credential.pem"),
    "file",
  );
  const config: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (
    !isRecord(config) || typeof config.tenantId !== "string" ||
    typeof config.clientId !== "string" || typeof config.subscriptionId !== "string"
  ) {
    throw new Error("Dev Graph config has an unexpected shape");
  }
  const credential = new ClientCertificateCredential(
    config.tenantId,
    config.clientId,
    { certificatePath: credentialPath },
  );
  const access = await credential.getToken("https://management.azure.com/.default");
  if (!access?.token) throw new Error("ARM token acquisition failed");
  const vmBase = `${ARM}/subscriptions/${config.subscriptionId}/resourceGroups/${AVD.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${AVD.vm}`;
  const hostBase = `${ARM}/subscriptions/${config.subscriptionId}/resourceGroups/${AVD.resourceGroup}/providers/Microsoft.DesktopVirtualization/hostPools/${AVD.hostPool}/sessionHosts/${AVD.sessionHost}`;

  const request = async (url: string, options: RequestInit = {}): Promise<{
    response: Response;
    body: JsonRecord | null;
  }> => {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${access.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    const text = await response.text();
    const body: unknown = text ? JSON.parse(text) : null;
    if (!response.ok || (body !== null && !isRecord(body))) {
      throw new Error(`${options.method ?? "GET"} ${url} -> ${response.status}`);
    }
    return { response, body };
  };

  const operation = async (initial: { response: Response }): Promise<void> => {
    const url = initial.response.headers.get("azure-asyncoperation") ??
      initial.response.headers.get("location");
    if (!url) return;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await delay(3_000);
      const current = (await request(url)).body;
      const status = String(current?.status ?? "");
      if (/succeeded/i.test(status)) return;
      if (/failed|canceled/i.test(status)) throw new Error(`ARM operation ${status}`);
    }
    throw new Error("ARM operation timed out");
  };

  const state = async (): Promise<AvdState> => {
    const [view, sessionHost, sessionsResult] = await Promise.all([
      request(`${vmBase}/instanceView?api-version=2024-11-01`),
      request(`${hostBase}?api-version=2024-04-03`),
      request(`${hostBase}/userSessions?api-version=2024-04-03`),
    ]);
    const statuses = Array.isArray(view.body?.statuses) ? view.body.statuses : [];
    const power = statuses.find((item) =>
      isRecord(item) && typeof item.code === "string" &&
      item.code.startsWith("PowerState/")
    );
    const properties = isRecord(sessionHost.body?.properties)
      ? sessionHost.body.properties
      : {};
    const sessionValues = Array.isArray(sessionsResult.body?.value)
      ? sessionsResult.body.value
      : [];
    return {
      observedUtc: new Date().toISOString(),
      powerState: isRecord(power) && typeof power.code === "string"
        ? power.code
        : undefined,
      sessionHostStatus: typeof properties.status === "string"
        ? properties.status
        : undefined,
      declaredSessionCount: typeof properties.sessions === "number"
        ? properties.sessions
        : undefined,
      userSessions: sessionValues.filter(isRecord).map((item) => {
        const sessionProperties = isRecord(item.properties) ? item.properties : {};
        return {
          id: typeof item.id === "string" ? item.id : "",
          userPrincipalName: typeof sessionProperties.userPrincipalName === "string"
            ? sessionProperties.userPrincipalName
            : undefined,
          sessionState: typeof sessionProperties.sessionState === "string"
            ? sessionProperties.sessionState
            : undefined,
        };
      }),
    };
  };

  return {
    state,
    start: async () => {
      await operation(await request(
        `${vmBase}/start?api-version=2024-11-01`,
        { method: "POST", body: "{}" },
      ));
    },
    logoff: async (sessionId) => {
      await request(`${ARM}${sessionId}?api-version=2024-04-03`, { method: "DELETE" });
    },
    deallocate: async () => {
      await operation(await request(
        `${vmBase}/deallocate?api-version=2024-11-01`,
        { method: "POST", body: "{}" },
      ));
    },
  };
}

const ARM = "https://management.azure.com";

async function precheck(context: Context): Promise<void> {
  const marge = await acquireMarge(context);
  const [rules, messages] = await Promise.all([
    exactRules(marge.mailbox.token, context.marker),
    exactMessages(marge.mail.token, context.marker, false),
  ]);
  const receipt = {
    runId: context.marker.runId,
    observedUtc: new Date().toISOString(),
    exactRuleCount: rules.length,
    exactAllMailMessageCount: messages.length,
    verifiedMargeIdentity: marge.identity,
  };
  writeReceipt(context, "precheck", receipt);
  if (rules.length !== 0 || messages.length !== 0) {
    throw new Error(`Unsafe exact-marker precheck: ${JSON.stringify(receipt)}`);
  }
  console.log(JSON.stringify(receipt, null, 2));
}

async function runProof(context: Context): Promise<void> {
  const avd = await armClient(context.runtimeRoot);
  const activeState = await avd.state();
  assertActiveMargeSession(activeState);

  const marge = await acquireMarge(context);
  const [beforeRules, beforeMessages] = await Promise.all([
    exactRules(marge.mailbox.token, context.marker),
    exactMessages(marge.mail.token, context.marker, false),
  ]);
  if (beforeRules.length !== 0 || beforeMessages.length !== 0) {
    throw new Error("Exact marker state is not empty; no rule or message was created");
  }

  const inventory = await graph(
    `${GRAPH}/me/mailFolders/inbox/messageRules?$top=257`,
    marge.mailbox.token,
  );
  const allRules = values(inventory, 256, "rule").filter(isRecord);
  const sequences = allRules.map((rule) => Number(rule.sequence));
  if (sequences.some((sequence) => !Number.isSafeInteger(sequence) || sequence < 0)) {
    throw new Error("Existing rule sequence boundary is ambiguous");
  }
  const request = ruleRequest(context.marker, Math.max(0, ...sequences) + 1);
  const created = await graph(
    `${GRAPH}/me/mailFolders/inbox/messageRules`,
    marge.mailbox.token,
    { method: "POST", body: JSON.stringify(request) },
  );
  const confirmedRules = await exactRules(marge.mailbox.token, context.marker);
  const shapeConfirmed = confirmedRules.length === 1 &&
    isExactRuleShape(confirmedRules[0], context.marker);
  writeReceipt(context, "rule-created", {
    requestedUtc: new Date().toISOString(),
    responseStatus: created.status,
    responseHeaders: created.headers,
    returnedRule: created.body,
    exactRuleCount: confirmedRules.length,
    exactRuleShape: shapeConfirmed,
    verifiedMargeIdentity: marge.identity,
    activeAvdState: activeState,
  });
  if (created.status !== 201 || !shapeConfirmed) {
    throw new Error("Marge rule creation was not exactly confirmed; no message was sent");
  }

  assertActiveMargeSession(await avd.state());
  if ((await exactMessages(marge.mail.token, context.marker, false)).length !== 0) {
    throw new Error("The exact message appeared before the send gate; no send was made");
  }
  const homer = await context.homer.getToken(SEND_SCOPE);
  if (!homer) throw new Error("Homer delegated token acquisition failed");
  const sendRequestedUtc = new Date().toISOString();
  const sent = await graph(`${GRAPH}/me/sendMail`, homer.token, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: context.marker.subject,
        body: {
          contentType: "Text",
          content: `Harmless internal AP2 marker for ${context.marker.runId}. This message requests no action.`,
        },
        toRecipients: [{
          emailAddress: { address: MARGE_IDENTITY.userPrincipalName },
        }],
      },
      saveToSentItems: false,
    }),
  });
  writeReceipt(context, "send-acceptance", {
    runId: context.marker.runId,
    sendRequestedUtc,
    responseStatus: sent.status,
    responseHeaders: sent.headers,
    senderIdentity: homer.identity,
    retryPermitted: false,
  });
  if (sent.status !== 202) {
    throw new Error(`The single send returned HTTP ${sent.status}; it must not be retried`);
  }

  let messages: JsonRecord[] = [];
  for (let attempt = 0; attempt < 48; attempt += 1) {
    messages = await exactMessages(marge.mail.token, context.marker, true);
    if (messages.length > 1) throw new Error("More than one exact marker message appeared");
    if (messages.length === 1 && messages[0]?.isRead === true) break;
    await delay(5_000);
  }
  const message = messages[0];
  const effectConfirmed = messages.length === 1 &&
    isExactEffectMessage(message, context.marker);
  writeReceipt(context, "effect", {
    runId: context.marker.runId,
    observedUtc: new Date().toISOString(),
    exactInboxMessageCount: messages.length,
    effectConfirmed,
    message,
    rule: confirmedRules[0],
    verifiedMargeIdentity: marge.identity,
    senderIdentity: homer.identity,
  });
  if (!effectConfirmed) throw new Error("The exact single-message mark-read effect was not confirmed");
  console.log(JSON.stringify({
    runId: context.marker.runId,
    ruleCreatedBy: marge.identity.userPrincipalName,
    ruleShapeConfirmed: true,
    sendAcceptedOnce: true,
    exactInboxMessageCount: 1,
    isRead: true,
  }, null, 2));
}

async function cleanup(context: Context): Promise<void> {
  const marge = await acquireMarge(context);
  const rules = await exactRules(marge.mailbox.token, context.marker);
  let messages = await exactMessages(marge.mail.token, context.marker, false);
  if (
    rules.length > 1 || messages.length > 1 ||
    (rules.length === 1 && !isExactRuleShape(rules[0], context.marker))
  ) {
    throw new Error("Exact cleanup boundary is ambiguous");
  }
  if (rules[0] && typeof rules[0].id === "string") {
    const deleted = await graph(
      `${GRAPH}/me/mailFolders/inbox/messageRules/${encodeURIComponent(rules[0].id)}`,
      marge.mailbox.token,
      { method: "DELETE" },
    );
    if (deleted.status !== 204) throw new Error(`Exact rule delete failed HTTP ${deleted.status}`);
  }
  if (messages[0] && typeof messages[0].id === "string") {
    const deleted = await graph(
      `${GRAPH}/me/messages/${encodeURIComponent(messages[0].id)}`,
      marge.mail.token,
      { method: "DELETE" },
    );
    if (deleted.status !== 204) throw new Error(`Exact message delete failed HTTP ${deleted.status}`);
  }

  let consecutiveEmptyReads = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    messages = await exactMessages(marge.mail.token, context.marker, false);
    if (messages.length === 0) {
      consecutiveEmptyReads += 1;
      if (consecutiveEmptyReads === 3) break;
      await delay(5_000);
      continue;
    }
    consecutiveEmptyReads = 0;
    if (messages.length > 1 || typeof messages[0]?.id !== "string") {
      throw new Error("Exact mailbox residue became ambiguous");
    }
    const permanentlyDeleted = await graph(
      `${GRAPH}/me/messages/${encodeURIComponent(messages[0].id)}/permanentDelete`,
      marge.mail.token,
      { method: "POST" },
    );
    if (permanentlyDeleted.status !== 204) {
      throw new Error(`Exact permanent delete failed HTTP ${permanentlyDeleted.status}`);
    }
    await delay(5_000);
  }
  const finalRules = await exactRules(marge.mailbox.token, context.marker);
  const finalInbox = await exactMessages(marge.mail.token, context.marker, true);
  const finalMailbox = await exactMessages(marge.mail.token, context.marker, false);
  const receipt = {
    runId: context.marker.runId,
    cleanedUtc: new Date().toISOString(),
    exactRuleCountAfter: finalRules.length,
    exactInboxMessageCountAfter: finalInbox.length,
    exactAllMailMessageCountAfter: finalMailbox.length,
    verifiedMargeIdentity: marge.identity,
  };
  writeReceipt(context, "cleanup", receipt);
  if (
    consecutiveEmptyReads < 3 || finalRules.length || finalInbox.length ||
    finalMailbox.length
  ) {
    throw new Error("Exact cleanup absence was not confirmed");
  }
  console.log(JSON.stringify(receipt, null, 2));
}

async function startAvd(context: Context): Promise<void> {
  const avd = await armClient(context.runtimeRoot);
  const before = await avd.state();
  if (before.powerState !== "PowerState/deallocated" || before.userSessions.length !== 0) {
    throw new Error(`Unsafe AVD start precondition: ${JSON.stringify(before)}`);
  }
  await avd.start();
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const after = await avd.state();
    if (after.powerState === "PowerState/running" && after.sessionHostStatus === "Available") {
      writeReceipt(context, "start-state", { before, after });
      console.log(JSON.stringify({ before, after }, null, 2));
      return;
    }
    await delay(3_000);
  }
  throw new Error("Marge VM did not become ready");
}

async function finalizeAvd(context: Context): Promise<void> {
  const avd = await armClient(context.runtimeRoot);
  const before = await avd.state();
  if (before.userSessions.length > 1 || before.userSessions.some((session) =>
    session.userPrincipalName?.toLowerCase() !==
      MARGE_IDENTITY.userPrincipalName.toLowerCase()
  )) {
    throw new Error(`Refusing to log off an unexpected AVD session: ${JSON.stringify(before)}`);
  }
  for (const session of before.userSessions) await avd.logoff(session.id);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if ((await avd.state()).userSessions.length === 0) break;
    await delay(2_000);
  }
  if ((await avd.state()).userSessions.length !== 0) {
    throw new Error("Marge AVD session did not log off");
  }
  await avd.deallocate();
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const after = await avd.state();
    if (after.powerState === "PowerState/deallocated" && after.userSessions.length === 0) {
      writeReceipt(context, "final-state", { before, after });
      console.log(JSON.stringify({ before, after }, null, 2));
      return;
    }
    await delay(3_000);
  }
  throw new Error("Final Marge logoff/deallocation reconciliation failed");
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const context = createContext();
  switch (process.argv[2]) {
    case "precheck":
      await precheck(context);
      break;
    case "start-avd":
      await startAvd(context);
      break;
    case "run":
      await runProof(context);
      break;
    case "cleanup":
      await cleanup(context);
      break;
    case "avd-state":
      console.log(JSON.stringify(await (await armClient(context.runtimeRoot)).state(), null, 2));
      break;
    case "finalize-avd":
      await finalizeAvd(context);
      break;
    default:
      throw new Error(
        "mode must be precheck, start-avd, run, cleanup, avd-state, or finalize-avd",
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "W53 method failed");
    process.exitCode = 1;
  });
}
