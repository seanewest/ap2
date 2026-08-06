import {
  INBOX_RULE_PROOF_DISPLAY_NAME,
  INBOX_RULE_PROOF_RUN_ID,
  INBOX_RULE_PROOF_SUBJECT,
} from "../api/client";
import type { FixedProofDefinition } from "./fixed-proof";

export const inboxRuleProofDefinition = {
  id: "inboxRuleProof",
  storageName: "inbox-rule-proof",
  runId: INBOX_RULE_PROOF_RUN_ID,
  label: "inbox-rule",
  messages: {
    "not-started": "Inbox rule: not started in this browser.",
    uncertain:
      "Inbox rule: creation is uncertain. Do not create again; Remove can reconcile it safely.",
    configured: "Inbox rule: configured and disabled.",
    "removal-uncertain":
      "Inbox rule: removal is uncertain. Do not repeat it.",
    removed: "Inbox rule: removed.",
  },
  activityTarget: "the fixed disabled Inbox rule",
  details: [
    ["Owner", "cory@corywest.onmicrosoft.com"],
    ["Rule", INBOX_RULE_PROOF_DISPLAY_NAME],
    ["Enabled", "No"],
    ["Subject contains", INBOX_RULE_PROOF_SUBJECT],
    ["Action", "Mark as read"],
  ],
  createButton: {
    label: "Create disabled Inbox rule",
    action: "create-inbox-rule",
  },
  removeButton: {
    label: "Remove disabled Inbox rule",
    action: "remove-inbox-rule",
  },
  create: (api, accessToken) => api.createInboxRuleProof(accessToken),
  remove: (api, accessToken) => api.removeInboxRuleProof(accessToken),
} satisfies FixedProofDefinition;
