#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const PROOF = Object.freeze({
  youTrackOrigin: "https://ap2-tester123.youtrack.cloud",
  appName: "ap2-scim-outbound-delivery",
  appTitle: "AP2 SCIM Outbound Delivery",
  configuredUser: Object.freeze({
    youTrackId: "5d6ac5f5-c76d-4351-a9c5-d9e20dc6f0ae",
    login: "kobe@corywest.onmicrosoft.com",
    entraId: "646cb944-5637-4410-bfc6-f338598e5804",
  }),
  entitlementGroupId: "abccbb36-0163-4825-8104-f9a85cd371a1",
  permanentTokenServiceId: "7782558b-93b9-47df-898b-99ae07e8a502",
  scimJobs: Object.freeze([
    Object.freeze({
      servicePrincipalId: "2624fbca-43b9-49a0-8fea-aa813ddc47f8",
      jobId:
        "scim.92563293315c4b6c9b90bcb47ee8c970.873e0f87-b451-49d5-9ac6-17c0c4e2a532",
    }),
    Object.freeze({
      servicePrincipalId: "e28ebc65-75bc-44eb-ae31-1aecb217dde5",
      jobId:
        "scim.92563293315c4b6c9b90bcb47ee8c970.d2b323b1-41c5-4be4-9d5d-a6a10ecf5691",
    }),
  ]),
  checkpoints: Object.freeze([
    "before-deactivation",
    "scim-deactivated-banned",
  ]),
});

export function buildAppFiles() {
  return {
    "manifest.json": `${JSON.stringify({
      $schema: "https://json.schemastore.org/youtrack-app.json",
      name: PROOF.appName,
      title: PROOF.appTitle,
      description: "Temporary harmless outbound delivery canary.",
      version: "1.0.0",
      vendor: {
        name: "AP2",
        url: "https://example.invalid",
        email: "noreply@example.invalid",
      },
    })}\n`,
    "entity-extensions.json": `${JSON.stringify({
      entityTypeExtensions: [
        {
          entityType: "AppGlobalStorage",
          properties: {
            lifecycleMarker: { type: "string" },
            configuredBy: { type: "string" },
          },
        },
      ],
    })}\n`,
    "backend.js": `const http = require('@jetbrains/youtrack-scripting-api/http');
exports.httpHandler = {endpoints: [
  {scope:'global',method:'POST',path:'configure',handle:function(ctx){const body=ctx.request.json();ctx.globalStorage.extensionProperties.lifecycleMarker=body.marker;ctx.globalStorage.extensionProperties.configuredBy=ctx.currentUser.login;ctx.response.json({configured:true,configuredBy:ctx.currentUser.login});}},
  {scope:'global',method:'POST',path:'deliver',handle:function(ctx){const body=ctx.request.json();const connection=new http.Connection(body.receiverBaseUrl);connection.addHeader('Content-Type','application/json');connection.addHeader('X-AP2-Receiver-Token',body.receiverToken);const response=connection.postSync('/api/receive',null,JSON.stringify({marker:ctx.globalStorage.extensionProperties.lifecycleMarker,configuredBy:ctx.globalStorage.extensionProperties.configuredBy,checkpoint:body.checkpoint}));ctx.response.json({outboundStatus:response?response.code:null,marker:ctx.globalStorage.extensionProperties.lifecycleMarker,configuredBy:ctx.globalStorage.extensionProperties.configuredBy});}},
  {scope:'global',method:'POST',path:'status',handle:function(ctx){ctx.response.json({marker:ctx.globalStorage.extensionProperties.lifecycleMarker||null,configuredBy:ctx.globalStorage.extensionProperties.configuredBy||null,running:true});}}
]};
`,
  };
}

function fail(message) {
  throw new Error(message);
}

function requireSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
}

export function validateMarker(marker) {
  if (!/^AP2-YT-OUTBOUND-[0-9]{8}T[0-9]{6}Z-[A-Z0-9-]+$/.test(marker)) {
    fail("AP2_RUN_MARKER must be a unique AP2-YT-OUTBOUND timestamp marker");
  }
  return marker;
}

export function validateReceiverOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") {
    fail("AP2_RECEIVER_BASE_URL must be an HTTPS origin without credentials or a path");
  }
  return url.origin;
}

export function assertExactDelivery(before, after, checkpoint) {
  if (
    !Number.isInteger(before?.count) ||
    !Array.isArray(before?.deliveries) ||
    after?.count !== before.count + 1 ||
    !Array.isArray(after?.deliveries) ||
    after.deliveries.length !== after.count
  ) {
    fail("receiver count did not advance exactly once");
  }
  const delivery = after.deliveries.at(-1);
  if (
    delivery?.checkpoint !== checkpoint ||
    delivery?.configuredBy !== PROOF.configuredUser.login
  ) {
    fail("receiver did not record the exact checkpoint and configuring user");
  }
}

function appPath(path) {
  return `/api/extensionEndpoints/${PROOF.appName}/backend/${path}`;
}

async function request(url, token, init = {}, allow = []) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!response.ok && !allow.includes(response.status)) {
    fail(`${init.method ?? "GET"} ${new URL(url).pathname} -> ${response.status}: ${text.slice(0, 300)}`);
  }
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body };
}

async function youTrack(path, token, init, allow) {
  return request(`${PROOF.youTrackOrigin}${path}`, token, init, allow);
}

async function graph(path, token, init, allow) {
  return request(`https://graph.microsoft.com/v1.0${path}`, token, init, allow);
}

async function listApps(adminToken) {
  const { body } = await youTrack(
    "/api/admin/apps?$top=100&fields=id,name,title,version",
    adminToken,
  );
  if (!Array.isArray(body)) fail("YouTrack app inventory had an unexpected shape");
  return body.filter((app) => app.name === PROOF.appName);
}

async function listTemporaryTokens(adminToken, tokenName) {
  const { body } = await youTrack(
    `/hub/api/rest/users/${PROOF.configuredUser.youTrackId}/permanenttokens?fields=id,name&$top=100`,
    adminToken,
  );
  const tokens = body?.permanenttokens;
  if (!Array.isArray(tokens)) fail("YouTrack token inventory had an unexpected shape");
  return tokens.filter((token) => token.name === tokenName);
}

async function deleteToken(adminToken, id) {
  await youTrack(
    `/hub/api/rest/users/${PROOF.configuredUser.youTrackId}/permanenttokens/${id}`,
    adminToken,
    { method: "DELETE" },
    [404],
  );
}

async function removeAllTemporaryTokens(adminToken, tokenName) {
  const matches = await listTemporaryTokens(adminToken, tokenName);
  for (const token of matches) {
    try {
      await deleteToken(adminToken, token.id);
    } catch (error) {
      const after = await listTemporaryTokens(adminToken, tokenName);
      if (after.some((candidate) => candidate.id === token.id)) {
        throw new Error(`temporary token deletion was not accepted and was not retried: ${error.message}`);
      }
    }
  }
  if ((await listTemporaryTokens(adminToken, tokenName)).length !== 0) {
    fail("temporary configuring token cleanup did not reconcile absent");
  }
}

async function getYouTrackUser(adminToken) {
  const { body } = await youTrack(
    `/hub/api/rest/users/${PROOF.configuredUser.youTrackId}?fields=id,login,banned`,
    adminToken,
  );
  if (body?.id !== PROOF.configuredUser.youTrackId || body.login !== PROOF.configuredUser.login) {
    fail("YouTrack returned a different configuring user");
  }
  return body;
}

async function isGroupMember(graphToken) {
  const { response } = await graph(
    `/groups/${PROOF.entitlementGroupId}/members/${PROOF.configuredUser.entraId}?$select=id`,
    graphToken,
    undefined,
    [404],
  );
  return response.status !== 404;
}

async function removeGroupMember(graphToken) {
  if (!(await isGroupMember(graphToken))) fail("Kobe is not in the entitlement group at the mutation gate");
  try {
    await graph(
      `/groups/${PROOF.entitlementGroupId}/members/${PROOF.configuredUser.entraId}/$ref`,
      graphToken,
      { method: "DELETE" },
    );
  } catch (error) {
    if (await isGroupMember(graphToken)) {
      throw new Error(`group removal was not accepted and will not be retried: ${error.message}`);
    }
  }
  if (await isGroupMember(graphToken)) fail("group removal did not reconcile absent");
}

async function restoreGroupMember(graphToken) {
  if (await isGroupMember(graphToken)) return;
  try {
    await graph(`/groups/${PROOF.entitlementGroupId}/members/$ref`, graphToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        "@odata.id":
          `https://graph.microsoft.com/v1.0/directoryObjects/${PROOF.configuredUser.entraId}`,
      }),
    });
  } catch (error) {
    if (!(await isGroupMember(graphToken))) {
      throw new Error(`group restoration was not accepted and will not be retried: ${error.message}`);
    }
  }
  if (!(await isGroupMember(graphToken))) fail("group restoration did not reconcile present");
}

async function triggerScim(graphToken) {
  for (const job of PROOF.scimJobs) {
    const path = `/servicePrincipals/${job.servicePrincipalId}/synchronization/jobs/${job.jobId}`;
    const { body } = await graph(path, graphToken);
    if (body?.id !== job.jobId || body?.schedule?.state !== "Active") {
      fail(`SCIM job ${job.jobId} is not the expected active job`);
    }
    try {
      await graph(`${path}/restart`, graphToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch (error) {
      // Restart is a propagation nudge, not the state mutation under test. Never retry it.
      process.stderr.write(`SCIM restart result was ambiguous and was not retried: ${error.message}\n`);
    }
  }
}

async function waitForBanned(adminToken, expected, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const user = await getYouTrackUser(adminToken);
    if (user.banned === expected) return user;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  fail(`YouTrack did not reach banned=${expected} before timeout`);
}

async function receiverStatus(receiverOrigin) {
  const { body } = await request(`${receiverOrigin}/api/status`, "");
  return body;
}

async function buildAppArchive(directory) {
  const files = buildAppFiles();
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(directory, name), contents, { mode: 0o600 });
  }
  const archive = join(directory, `${PROOF.appName}.zip`);
  const zipped = spawnSync(
    "zip",
    ["-q", "-FS", archive, "manifest.json", "backend.js", "entity-extensions.json"],
    { cwd: directory, encoding: "utf8" },
  );
  if (zipped.status !== 0) fail(`zip failed: ${zipped.stderr || zipped.stdout}`);
  return archive;
}

async function installApp(adminToken, archivePath) {
  if ((await listApps(adminToken)).length !== 0) fail("temporary app already exists");
  const form = new FormData();
  form.set("file", new Blob([await readFile(archivePath)]), `${PROOF.appName}.zip`);
  let importError;
  try {
    await youTrack("/api/admin/apps/import?fields=id,name,title,version", adminToken, {
      method: "POST",
      body: form,
    });
  } catch (error) {
    importError = error;
  }
  const matches = await listApps(adminToken);
  if (matches.length !== 1) {
    fail(`app import did not reconcile to one exact app; it was not retried (${importError?.message ?? "no transport error"})`);
  }
  return matches[0];
}

async function configureApp(adminToken, marker, tokenName) {
  if ((await listTemporaryTokens(adminToken, tokenName)).length !== 0) {
    fail("temporary configuring token already exists");
  }
  let tokenId;
  let userToken;
  try {
    let created;
    try {
      created = await youTrack(
        `/hub/api/rest/users/${PROOF.configuredUser.youTrackId}/permanenttokens?fields=id,name,token,scope(id,name)`,
        adminToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: tokenName,
            scope: [{ id: PROOF.permanentTokenServiceId }],
          }),
        },
      );
    } catch (error) {
      await removeAllTemporaryTokens(adminToken, tokenName);
      throw new Error(`temporary token creation was ambiguous, cleaned up, and not retried: ${error.message}`);
    }
    tokenId = created.body?.id;
    userToken = created.body?.token;
    if (!tokenId || !userToken) fail("YouTrack did not return the temporary token once");

    let configureError;
    try {
      const { body } = await youTrack(appPath("configure"), userToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marker }),
      });
      if (body?.configuredBy !== PROOF.configuredUser.login) fail("app recorded a different configuring user");
    } catch (error) {
      configureError = error;
    }
    const status = await appStatus(adminToken);
    if (status.marker !== marker || status.configuredBy !== PROOF.configuredUser.login) {
      fail(`configure did not reconcile and was not retried: ${configureError?.message ?? "state mismatch"}`);
    }
  } finally {
    userToken = undefined;
    await removeAllTemporaryTokens(adminToken, tokenName);
  }
}

async function appStatus(adminToken) {
  const { body } = await youTrack(appPath("status"), adminToken, { method: "POST" });
  return body;
}

async function deliverOnce(adminToken, receiverOrigin, receiverToken, checkpoint) {
  const before = await receiverStatus(receiverOrigin);
  let deliveryError;
  try {
    const { body } = await youTrack(appPath("deliver"), adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receiverBaseUrl: receiverOrigin,
        receiverToken,
        checkpoint,
      }),
    });
    if (body?.outboundStatus !== 204) fail("YouTrack app did not report outbound HTTP 204");
  } catch (error) {
    deliveryError = error;
  }
  const after = await receiverStatus(receiverOrigin);
  try {
    assertExactDelivery(before, after, checkpoint);
  } catch (error) {
    throw new Error(`delivery was not retried after an ambiguous result: ${deliveryError?.message ?? error.message}`);
  }
  return after;
}

async function deleteApp(adminToken, appId) {
  const matches = await listApps(adminToken);
  if (matches.length > 1 || (appId && matches.length === 1 && matches[0].id !== appId)) {
    fail("temporary app cleanup identity is ambiguous");
  }
  if (matches.length === 1) {
    let deleteError;
    try {
      await youTrack(`/api/admin/apps/${matches[0].id}`, adminToken, { method: "DELETE" }, [404]);
    } catch (error) {
      deleteError = error;
    }
    const after = await listApps(adminToken);
    if (after.length !== 0) {
      throw new Error(`temporary app deletion was not accepted and was not retried: ${deleteError?.message ?? "app remains"}`);
    }
    return;
  }
  if ((await listApps(adminToken)).length !== 0) fail("temporary app cleanup did not reconcile absent");
}

export async function runCycle() {
  const marker = validateMarker(requireSecret("AP2_RUN_MARKER"));
  if (process.env.AP2_CONFIRM_YOUTRACK_DEACTIVATION_CYCLE !== marker) {
    fail("AP2_CONFIRM_YOUTRACK_DEACTIVATION_CYCLE must exactly equal AP2_RUN_MARKER");
  }
  const receiverOrigin = validateReceiverOrigin(requireSecret("AP2_RECEIVER_BASE_URL"));
  const receiverToken = requireSecret("AP2_RECEIVER_TOKEN");
  const adminToken = requireSecret("AP2_YOUTRACK_ADMIN_TOKEN");
  const graphToken = requireSecret("AP2_GRAPH_TOKEN");
  const tokenName = `AP2 outbound configure ${marker}`;
  const directory = await mkdtemp(join(tmpdir(), "ap2-youtrack-outbound-"));
  let app;
  let appCleanupAuthorized = false;
  let tokenCleanupAuthorized = false;
  let groupMutationAttempted = false;
  const cleanupErrors = [];

  try {
    if (!(await isGroupMember(graphToken))) fail("Kobe must begin in the entitlement group");
    if ((await getYouTrackUser(adminToken)).banned) fail("Kobe must begin active in YouTrack");
    if ((await listApps(adminToken)).length !== 0) fail("temporary app must begin absent");
    if ((await listTemporaryTokens(adminToken, tokenName)).length !== 0) {
      fail("temporary configuring token already exists for this unique marker");
    }
    const receiver = await receiverStatus(receiverOrigin);
    if (receiver.count !== 0 || receiver.deliveries?.length !== 0) {
      fail("receiver must begin empty for this one cycle");
    }

    appCleanupAuthorized = true;
    app = await installApp(adminToken, await buildAppArchive(directory));
    tokenCleanupAuthorized = true;
    await configureApp(adminToken, marker, tokenName);
    await deliverOnce(
      adminToken,
      receiverOrigin,
      receiverToken,
      PROOF.checkpoints[0],
    );

    groupMutationAttempted = true;
    await removeGroupMember(graphToken);
    await triggerScim(graphToken);
    await waitForBanned(adminToken, true);

    const status = await appStatus(adminToken);
    if (status.marker !== marker || status.configuredBy !== PROOF.configuredUser.login) {
      fail("app lost its exact marker or configuring identity while Kobe was banned");
    }
    const finalReceiver = await deliverOnce(
      adminToken,
      receiverOrigin,
      receiverToken,
      PROOF.checkpoints[1],
    );
    if (finalReceiver.count !== 2) fail("one cycle must end with exactly two deliveries");
  } finally {
    if (groupMutationAttempted) {
      await restoreGroupMember(graphToken).catch((error) => cleanupErrors.push(error));
      await triggerScim(graphToken).catch((error) => cleanupErrors.push(error));
      await waitForBanned(adminToken, false).catch((error) => cleanupErrors.push(error));
    }
    if (tokenCleanupAuthorized) {
      await removeAllTemporaryTokens(adminToken, tokenName).catch((error) => cleanupErrors.push(error));
    }
    if (appCleanupAuthorized) {
      await deleteApp(adminToken, app?.id).catch((error) => cleanupErrors.push(error));
    }
    await rm(directory, { recursive: true, force: true });
  }

  if (cleanupErrors.length) {
    fail(`cleanup failed: ${cleanupErrors.map((error) => error.message).join("; ")}`);
  }
  if (!(await isGroupMember(graphToken))) fail("final group membership is not restored");
  if ((await getYouTrackUser(adminToken)).banned) fail("final YouTrack user remains banned");
  if ((await listTemporaryTokens(adminToken, tokenName)).length !== 0) fail("temporary token remains");
  if ((await listApps(adminToken)).length !== 0) fail("temporary app remains");
  process.stdout.write(`${JSON.stringify({ marker, result: "two deliveries; baseline restored" })}\n`);
}

export function startReceiver() {
  const marker = validateMarker(requireSecret("AP2_RUN_MARKER"));
  const token = requireSecret("AP2_RECEIVER_TOKEN");
  const deliveries = [];
  const server = http.createServer((incoming, response) => {
    if (incoming.method === "GET" && incoming.url === "/api/status") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ count: deliveries.length, deliveries }));
      return;
    }
    if (incoming.method !== "POST" || incoming.url !== "/api/receive") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16_384) incoming.destroy();
    });
    incoming.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = null;
      }
      const expectedCheckpoint = PROOF.checkpoints[deliveries.length];
      if (
        incoming.headers["x-ap2-receiver-token"] !== token ||
        parsed?.marker !== marker ||
        parsed?.configuredBy !== PROOF.configuredUser.login ||
        parsed?.checkpoint !== expectedCheckpoint ||
        deliveries.length >= PROOF.checkpoints.length
      ) {
        response.writeHead(403).end();
        return;
      }
      deliveries.push({
        checkpoint: parsed.checkpoint,
        configuredBy: parsed.configuredBy,
      });
      response.writeHead(204).end();
    });
  });
  server.listen(Number(process.env.PORT || 3000), "0.0.0.0");
  return server;
}

export function offlineCheck() {
  const files = buildAppFiles();
  const manifest = JSON.parse(files["manifest.json"]);
  const extensions = JSON.parse(files["entity-extensions.json"]);
  if (
    manifest.name !== PROOF.appName ||
    extensions.entityTypeExtensions?.[0]?.entityType !== "AppGlobalStorage" ||
    !files["backend.js"].includes("X-AP2-Receiver-Token") ||
    !files["backend.js"].includes("configuredBy") ||
    PROOF.scimJobs.length !== 2
  ) {
    fail("recovered W21 source contract is incomplete");
  }
  process.stdout.write("PASS W21 fixed identity, app source, one-cycle checkpoints, and cleanup contract\n");
}

async function main() {
  const mode = process.argv[2] ?? "--check";
  if (mode === "--check") offlineCheck();
  else if (mode === "--receiver") startReceiver();
  else if (mode === "--execute") await runCycle();
  else fail("usage: node scripts/youtrack-deactivated-app-delivery.mjs [--check|--receiver|--execute]");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
