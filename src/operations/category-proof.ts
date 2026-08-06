import {
  CATEGORY_PROOF_COLOR,
  CATEGORY_PROOF_DISPLAY_NAME,
  CATEGORY_PROOF_RUN_ID,
} from "../api/client";
import type { FixedProofDefinition } from "./fixed-proof";

export const categoryProofDefinition = {
  id: "categoryProof",
  storageName: "category-proof",
  runId: CATEGORY_PROOF_RUN_ID,
  label: "category",
  notice:
    "Real tenant activity: Cory creates one fixed harmless Outlook category, then explicitly removes it.",
  messages: {
    "not-started": "Outlook category: not started in this browser.",
    uncertain:
      "Outlook category: creation is uncertain. Do not create again; Remove can reconcile it safely.",
    configured: "Outlook category: configured.",
    "removal-uncertain":
      "Outlook category: removal is uncertain. Do not repeat it.",
    removed: "Outlook category: removed.",
  },
  activityTarget: "the fixed Outlook category",
  details: [
    ["Owner", "cory@corywest.onmicrosoft.com"],
    ["Category", CATEGORY_PROOF_DISPLAY_NAME],
    ["Color preset", CATEGORY_PROOF_COLOR],
  ],
  createButton: {
    label: "Create Outlook category",
    action: "create-category-proof",
  },
  removeButton: {
    label: "Remove Outlook category",
    action: "remove-category-proof",
  },
  create: (api, accessToken) => api.createCategoryProof(accessToken),
  remove: (api, accessToken) => api.removeCategoryProof(accessToken),
} satisfies FixedProofDefinition;
