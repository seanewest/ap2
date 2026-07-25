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
    "not-started": "Category rehearsal: not started in this browser.",
    uncertain:
      "Category rehearsal: Create is uncertain. Do not create again; Remove can reconcile it safely.",
    configured: "Category rehearsal: Configured.",
    "removal-uncertain":
      "Category rehearsal: Remove is uncertain. Do not repeat it.",
    removed: "Category rehearsal: Removed.",
  },
  activityTarget: "the fixed Outlook category",
  details: [
    ["Owner", "cory@corywest.onmicrosoft.com"],
    ["Category", CATEGORY_PROOF_DISPLAY_NAME],
    ["Color preset", CATEGORY_PROOF_COLOR],
  ],
  createButton: {
    label: "Create Outlook category proof",
    action: "create-category-proof",
  },
  removeButton: {
    label: "Remove Outlook category proof",
    action: "remove-category-proof",
  },
  create: (api, accessToken) => api.createCategoryProof(accessToken),
  remove: (api, accessToken) => api.removeCategoryProof(accessToken),
} satisfies FixedProofDefinition;
