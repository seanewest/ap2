import {
  TODO_TASK_PROOF_RUN_ID,
  TODO_TASK_PROOF_TITLE,
} from "../api/client";
import type { FixedProofDefinition } from "./fixed-proof";

export const todoTaskProofDefinition = {
  id: "todoTaskProof",
  storageName: "todo-task-proof",
  runId: TODO_TASK_PROOF_RUN_ID,
  label: "To Do task",
  notice:
    "Real tenant activity: Cory creates one fixed harmless Microsoft To Do task, then explicitly removes it. The task is never completed or shared.",
  messages: {
    "not-started": "To Do task: not started in this browser.",
    uncertain:
      "To Do task: creation is uncertain. Do not create again; Remove can reconcile it safely.",
    configured: "To Do task: configured.",
    "removal-uncertain":
      "To Do task: removal is uncertain. Do not repeat it.",
    removed: "To Do task: removed.",
  },
  activityTarget: "the fixed To Do task",
  details: [
    ["Owner", "cory@corywest.onmicrosoft.com"],
    ["List", "Default To Do list"],
    ["Title", TODO_TASK_PROOF_TITLE],
    ["Status", "Not started"],
    ["Importance", "Low"],
    ["Reminder", "Off"],
    ["Categories", "None"],
  ],
  createButton: {
    label: "Create To Do task",
    action: "create-todo-task-proof",
  },
  removeButton: {
    label: "Remove To Do task",
    action: "remove-todo-task-proof",
  },
  create: (api, accessToken) => api.createTodoTaskProof(accessToken),
  remove: (api, accessToken) => api.removeTodoTaskProof(accessToken),
} satisfies FixedProofDefinition;
