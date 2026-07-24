import type { AccountIdentity } from "../auth/authentication";
import { categoryProofDefinition } from "./category-proof";
import { draftProofDefinition } from "./draft-proof";
import {
  createFixedProofPanel,
  fixedProofStorageKey,
  readFixedProofStage,
  type FixedProofDefinition,
  type FixedProofId,
  type FixedProofState,
  type FixedProofStates,
} from "./fixed-proof";
import { inboxRuleProofDefinition } from "./inbox-rule-proof";
import { sharePointFileProofDefinition } from "./sharepoint-file-proof";
import { todoTaskProofDefinition } from "./todo-task-proof";

export {
  fixedProofStorageKey,
  isAllowedFixedProofAction,
  persistFixedProofStage,
  type FixedProofId,
  type FixedProofState,
  type FixedProofStates,
} from "./fixed-proof";

export const FIXED_PROOF_BY_ID = {
  inboxRuleProof: inboxRuleProofDefinition,
  categoryProof: categoryProofDefinition,
  sharePointFileProof: sharePointFileProofDefinition,
  draftProof: draftProofDefinition,
  todoTaskProof: todoTaskProofDefinition,
} satisfies Record<FixedProofId, FixedProofDefinition>;

export const FIXED_PROOF_DEFINITIONS: readonly FixedProofDefinition[] =
  Object.values(FIXED_PROOF_BY_ID);

export function readFixedProofStates(
  storage: Pick<Storage, "getItem">,
  account: AccountIdentity,
): FixedProofStates {
  return Object.fromEntries(
    FIXED_PROOF_DEFINITIONS.map((definition) => [
      definition.id,
      {
        stage: readFixedProofStage(
          storage,
          fixedProofStorageKey(account, definition),
        ),
        activity: "idle",
      } satisfies FixedProofState,
    ]),
  ) as FixedProofStates;
}

export function hasBusyFixedProof(states: FixedProofStates): boolean {
  return FIXED_PROOF_DEFINITIONS.some(
    ({ id }) => states[id].activity !== "idle",
  );
}

export function createFixedProofPanels(
  states: FixedProofStates,
  apiOperationLoading: boolean,
): HTMLElement[] {
  return FIXED_PROOF_DEFINITIONS.map((definition) =>
    createFixedProofPanel(
      definition,
      states[definition.id],
      apiOperationLoading,
    )
  );
}

export function bindFixedProofActions(
  root: HTMLElement,
  run: (proof: FixedProofId, action: "create" | "remove") => void,
): void {
  for (const definition of FIXED_PROOF_DEFINITIONS) {
    root
      .querySelector<HTMLButtonElement>(
        `[data-action='${definition.createButton.action}']`,
      )
      ?.addEventListener("click", () => run(definition.id, "create"));
    root
      .querySelector<HTMLButtonElement>(
        `[data-action='${definition.removeButton.action}']`,
      )
      ?.addEventListener("click", () => run(definition.id, "remove"));
  }
}
