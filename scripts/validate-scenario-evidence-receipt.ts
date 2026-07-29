import {
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { AVD_THREE_VM_SCENARIO } from "../src/scenarios/avd-three-vm.ts";
import { HELP_DESK_EMAIL_SCENARIO } from "../src/scenarios/help-desk-email.ts";
import { OAUTH_APPLICATION_RECON_SCENARIO } from "../src/scenarios/oauth-application-recon.ts";
import { PURVIEW_AUDIT_BOUNDARY_SCENARIO } from "../src/scenarios/purview-audit-boundary.ts";
import { PRIVATE_DOCUMENT_EVIDENCE_SCENARIO } from "../src/scenarios/private-document-evidence.ts";
import {
  EvidenceReceiptError,
  formatVerifiedClaimTable,
  readScenarioIdFromEvidenceReceipt,
  verifyScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-receipt.ts";
import { TEAMS_MISSED_CALL_SCENARIO } from "../src/scenarios/teams-missed-call.ts";

const MAX_RECEIPT_BYTES = 256 * 1024;
const RECEIPT_MANIFESTS = [
  HELP_DESK_EMAIL_SCENARIO,
  AVD_THREE_VM_SCENARIO,
  TEAMS_MISSED_CALL_SCENARIO,
  OAUTH_APPLICATION_RECON_SCENARIO,
  PURVIEW_AUDIT_BOUNDARY_SCENARIO,
  PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
];

export type ReceiptCliFailure =
  | "argument"
  | "file"
  | "json"
  | "scenario"
  | EvidenceReceiptError["code"];

export class ReceiptCliError extends Error {
  readonly failure: ReceiptCliFailure;

  constructor(failure: ReceiptCliFailure) {
    super("Scenario evidence receipt validation failed.");
    this.name = "ReceiptCliError";
    this.failure = failure;
  }
}

export function validateScenarioEvidenceReceiptFile(
  configuredPath: string,
): string {
  let path: string;
  let bytes: number;
  try {
    path = realpathSync(configuredPath);
    const status = statSync(path);
    if (!status.isFile() || status.size > MAX_RECEIPT_BYTES) {
      throw new ReceiptCliError("file");
    }
    bytes = status.size;
  } catch (error) {
    if (error instanceof ReceiptCliError) {
      throw error;
    }
    throw new ReceiptCliError("file");
  }
  if (bytes === 0) {
    throw new ReceiptCliError("file");
  }

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ReceiptCliError("json");
  }

  let scenarioId: string;
  try {
    scenarioId = readScenarioIdFromEvidenceReceipt(value);
  } catch (error) {
    throw receiptFailure(error);
  }
  const manifest = RECEIPT_MANIFESTS.find(
    (candidate) => candidate.id === scenarioId,
  );
  if (!manifest) {
    throw new ReceiptCliError("scenario");
  }
  try {
    return formatVerifiedClaimTable(
      verifyScenarioEvidenceReceipt(value, manifest),
    );
  } catch (error) {
    throw receiptFailure(error);
  }
}

function receiptFailure(error: unknown): ReceiptCliError {
  if (error instanceof EvidenceReceiptError) {
    return new ReceiptCliError(error.code);
  }
  return new ReceiptCliError("shape");
}

function main(args: readonly string[]): void {
  const receiptPath = args[0];
  if (
    args.length !== 1 ||
    receiptPath === undefined ||
    receiptPath.trim() === ""
  ) {
    throw new ReceiptCliError("argument");
  }
  console.log(validateScenarioEvidenceReceiptFile(receiptPath));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const failure = error instanceof ReceiptCliError
      ? error.failure
      : "shape";
    console.error(`INVALID\t${failure}`);
    process.exitCode = 2;
  }
}
