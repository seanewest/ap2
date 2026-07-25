import {
  SHAREPOINT_FILE_PROOF_NAME,
  SHAREPOINT_FILE_PROOF_RUN_ID,
} from "../api/client";
import type { FixedProofDefinition } from "./fixed-proof";

export const sharePointFileProofDefinition = {
  id: "sharePointFileProof",
  storageName: "sharepoint-file-proof",
  runId: SHAREPOINT_FILE_PROOF_RUN_ID,
  label: "SharePoint file",
  notice:
    "Real tenant activity: the API managed identity creates one fixed harmless file in SharePoint root Documents, then explicitly removes it to the recycle bin.",
  messages: {
    "not-started": "SharePoint file rehearsal: not started in this browser.",
    uncertain:
      "SharePoint file rehearsal: Create is uncertain. Do not create again; Remove can reconcile it safely.",
    configured: "SharePoint file rehearsal: Configured.",
    "removal-uncertain":
      "SharePoint file rehearsal: Remove is uncertain. Do not repeat it.",
    removed: "SharePoint file rehearsal: Removed to SharePoint recycle bin.",
  },
  activityTarget: "the fixed SharePoint file",
  details: [
    ["Actor", "API system managed identity"],
    ["Location", "SharePoint root Documents"],
    ["File", SHAREPOINT_FILE_PROOF_NAME],
    ["Content size", "78 ASCII bytes"],
  ],
  createButton: {
    label: "Create SharePoint file proof",
    action: "create-sharepoint-file-proof",
  },
  removeButton: {
    label: "Remove SharePoint file proof",
    action: "remove-sharepoint-file-proof",
  },
  create: (api, accessToken) => api.createSharePointFileProof(accessToken),
  remove: (api, accessToken) => api.removeSharePointFileProof(accessToken),
} satisfies FixedProofDefinition;
