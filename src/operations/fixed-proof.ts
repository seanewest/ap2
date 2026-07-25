import type { AccountIdentity } from "../auth/authentication";
import type { AfterPartyApi } from "../api/client";
import {
  appendIdentity,
  createButton,
  createStatus,
} from "../ui/elements";

export type FixedProofId =
  | "inboxRuleProof"
  | "categoryProof"
  | "sharePointFileProof"
  | "draftProof"
  | "todoTaskProof";

export type FixedProofStage =
  | "not-started"
  | "uncertain"
  | "configured"
  | "removal-uncertain"
  | "removed";

export type FixedProofState = {
  stage: FixedProofStage;
  activity: "idle" | "creating" | "removing";
  message?: string;
};

export type FixedProofStates = Record<FixedProofId, FixedProofState>;

type FixedProofResult = { state: "configured" | "removed" };

export interface FixedProofDefinition {
  id: FixedProofId;
  storageName: string;
  runId: string;
  label: string;
  notice: string;
  messages: Record<FixedProofStage, string>;
  activityTarget: string;
  details: readonly (readonly [label: string, value: string])[];
  createButton: {
    label: string;
    action: string;
  };
  removeButton: {
    label: string;
    action: string;
  };
  create(api: AfterPartyApi, accessToken: string): Promise<FixedProofResult>;
  remove(api: AfterPartyApi, accessToken: string): Promise<FixedProofResult>;
}

export function createFixedProofPanel(
  definition: FixedProofDefinition,
  state: FixedProofState,
  apiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "api-access";
  panel.append(createStatus(definition.notice, "notice"));
  panel.append(
    createStatus(
      state.activity === "idle"
        ? definition.messages[state.stage]
        : `${state.activity === "creating" ? "Creating" : "Removing"} ${definition.activityTarget}…`,
    ),
  );
  if (state.activity !== "idle") {
    panel.setAttribute("aria-busy", "true");
  }
  if (state.message) {
    panel.append(createStatus(state.message, "error"));
  }
  const details = document.createElement("dl");
  details.className = "identity-list";
  for (const [label, value] of definition.details) {
    appendIdentity(details, label, value);
  }
  panel.append(
    details,
    createButton(
      definition.createButton.label,
      definition.createButton.action,
      "primary",
      apiOperationLoading || state.stage !== "not-started",
    ),
    createButton(
      definition.removeButton.label,
      definition.removeButton.action,
      "secondary",
      apiOperationLoading ||
        !["configured", "uncertain"].includes(state.stage),
    ),
  );
  return panel;
}

export function fixedProofStorageKey(
  account: AccountIdentity,
  definition: FixedProofDefinition,
): string {
  return `ap2.${definition.storageName}.${definition.runId}.${account.tenantId}.${account.accountId}`;
}

export function readFixedProofStage(
  storage: Pick<Storage, "getItem">,
  key: string,
): FixedProofStage {
  const value = storage.getItem(key);
  return ["uncertain", "configured", "removal-uncertain", "removed"].includes(
    value ?? "",
  )
    ? value as FixedProofStage
    : "not-started";
}

export function persistFixedProofStage(
  storage: Pick<Storage, "setItem">,
  key: string,
  stage: FixedProofStage,
): void {
  storage.setItem(key, stage);
}

export function isAllowedFixedProofAction(
  stage: FixedProofStage,
  action: "create" | "remove",
): boolean {
  return action === "create"
    ? stage === "not-started"
    : stage === "configured" || stage === "uncertain";
}
