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
  notice:
    "Real tenant activity: Cory creates one fixed harmless disabled Inbox rule, then explicitly removes it.",
  messages: {
    "not-started": "Inbox-rule rehearsal: not started in this browser.",
    uncertain:
      "Inbox-rule rehearsal: Create is uncertain. Do not create again; Remove can reconcile it safely.",
    configured: "Inbox-rule rehearsal: Configured and disabled.",
    "removal-uncertain":
      "Inbox-rule rehearsal: Remove is uncertain. Do not repeat it.",
    removed: "Inbox-rule rehearsal: Removed.",
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
