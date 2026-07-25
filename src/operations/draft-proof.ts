import {
  DRAFT_PROOF_BODY,
  DRAFT_PROOF_RECIPIENTS,
  DRAFT_PROOF_RUN_ID,
  DRAFT_PROOF_SUBJECT,
} from "../api/client";
import type { FixedProofDefinition } from "./fixed-proof";

export const draftProofDefinition = {
  id: "draftProof",
  storageName: "draft-proof",
  runId: DRAFT_PROOF_RUN_ID,
  label: "unsent draft",
  notice:
    "Real tenant activity: Cory creates one fixed harmless unsent Outlook draft, then explicitly removes it. This operation never sends mail.",
  messages: {
    "not-started": "Draft rehearsal: not started in this browser.",
    uncertain:
      "Draft rehearsal: Create is uncertain. Do not create again; Remove can reconcile it safely.",
    configured: "Draft rehearsal: Configured as an unsent draft.",
    "removal-uncertain":
      "Draft rehearsal: Remove is uncertain. Do not repeat it.",
    removed: "Draft rehearsal: Removed.",
  },
  activityTarget: "the fixed unsent draft",
  details: [
    ["Owner", "cory@corywest.onmicrosoft.com"],
    ["State", "Unsent draft"],
    ["Subject", DRAFT_PROOF_SUBJECT],
    ["Body", DRAFT_PROOF_BODY],
    ["To", DRAFT_PROOF_RECIPIENTS.join(", ")],
    ["Cc / Bcc", "None"],
    ["Importance", "Low"],
    ["Attachments", "None"],
  ],
  createButton: {
    label: "Create unsent draft proof",
    action: "create-draft-proof",
  },
  removeButton: {
    label: "Remove unsent draft proof",
    action: "remove-draft-proof",
  },
  create: (api, accessToken) => api.createDraftProof(accessToken),
  remove: (api, accessToken) => api.removeDraftProof(accessToken),
} satisfies FixedProofDefinition;
