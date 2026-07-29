import { AzureNamedKeyCredential, TableClient } from "@azure/data-tables";
import {
  AzureTableSharedOperationJournal,
  type SharedOperationIdentity,
} from "../api/shared-operation-journal.ts";

const endpoint = process.env.AP2_EMULATOR_ENDPOINT;
const accountName = process.env.AP2_EMULATOR_ACCOUNT_NAME;
const accountKey = process.env.AP2_EMULATOR_ACCOUNT_KEY;
const owner = process.env.AP2_EMULATOR_OWNER;
if (!endpoint || !accountName || !accountKey || !owner) {
  throw new Error("EMULATOR_WORKER_INPUT_REFUSED");
}

const identity: SharedOperationIdentity = {
  markerAlias: "emulator-journal-canary",
  operationKind: "calendar.create",
  actorAlias: "cory-actor",
  targetAlias: "calendar-target",
};
const client = new TableClient(
  `${endpoint}/${accountName}`,
  "ap2operations",
  new AzureNamedKeyCredential(accountName, accountKey),
  { allowInsecureConnection: true, retryOptions: { maxRetries: 0 } },
);
const journal = new AzureTableSharedOperationJournal(client, 3_600);
const result = await journal.acquireDispatch(
  identity,
  owner,
  "2026-07-29T12:00:00.000Z",
  30,
);

process.stdout.write(`${JSON.stringify({
  kind: result.kind,
  reason: result.kind === "refused" ? result.reason : undefined,
})}\n`);
