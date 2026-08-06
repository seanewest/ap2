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
  messages: {
    "not-started": "Unsent draft: not started in this browser.",
    uncertain:
      "Unsent draft: creation is uncertain. Do not create again; Remove can reconcile it safely.",
    configured: "Unsent draft: configured.",
    "removal-uncertain":
      "Unsent draft: removal is uncertain. Do not repeat it.",
    removed: "Unsent draft: removed.",
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
    label: "Create unsent draft",
    action: "create-draft-proof",
  },
  removeButton: {
    label: "Remove unsent draft",
    action: "remove-draft-proof",
  },
  create: (api, accessToken) => api.createDraftProof(accessToken),
  remove: (api, accessToken) => api.removeDraftProof(accessToken),
} satisfies FixedProofDefinition;
