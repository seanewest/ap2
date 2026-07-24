import {
  CORY_USER_PRINCIPAL_NAME, type DelegatedGraphToken,
  type DelegatedGraphTokenProvider, type SimulatedUserIdentity,
} from "./simulated-user.js";

const LISTS_URL = "https://graph.microsoft.com/v1.0/me/todo/lists";
export const GRAPH_TASKS_READ_WRITE_SCOPE =
  "https://graph.microsoft.com/Tasks.ReadWrite";
export const TODO_TASK_TITLE =
  "AP2 harmless task [ap2-todo-task-20260725-002]";
export type TodoTaskProofResult =
  { state: "configured" | "removed"; title: typeof TODO_TASK_TITLE };
export interface TodoTaskProofOperation {
  create(): Promise<TodoTaskProofResult>; remove(): Promise<TodoTaskProofResult>;
}
export class TodoTaskProofConflictError extends Error {}
export class DelegatedGraphTodoTaskProof implements TodoTaskProofOperation {
  private retained?: { listId: string; taskId: string };

  constructor(
    private readonly tokenProvider: DelegatedGraphTokenProvider,
    private readonly cory: SimulatedUserIdentity,
    private readonly request: typeof fetch = fetch.bind(globalThis),
  ) {
    if (cory.userPrincipalName !== CORY_USER_PRINCIPAL_NAME) {
      throw new TypeError("The To Do task owner must be Cory West.");
    }
  }

  async create(): Promise<TodoTaskProofResult> {
    const token = await this.coryToken();
    const listId = await this.defaultListId(token.token);
    const existing = await this.findExact(token.token, listId);
    if (existing) {
      this.retain(listId, existing.id);
      return result("configured");
    }
    const response = await this.request(tasksUrl(listId), {
      method: "POST",
      redirect: "error",
      headers: graphHeaders(token.token, true),
      body: JSON.stringify({
        title: TODO_TASK_TITLE,
        status: "notStarted",
        importance: "low",
        isReminderOn: false,
        categories: [],
      }),
    });
    const created = await readJson(response);
    if (response.status !== 201 || !isExactTask(created)) {
      throw new Error(
        `Microsoft Graph task creation returned an unconfirmed HTTP ${response.status} result.`,
      );
    }
    this.retain(listId, created.id);
    return result("configured");
  }

  async remove(): Promise<TodoTaskProofResult> {
    const token = await this.coryToken();
    const listId = await this.defaultListId(token.token);
    const existing = await this.findExact(token.token, listId);
    if (!existing) {
      this.retained = undefined;
      return result("removed");
    }
    if (
      this.retained &&
      (this.retained.listId !== listId || this.retained.taskId !== existing.id)
    ) {
      throw new TodoTaskProofConflictError();
    }
    const response = await this.request(
      `${tasksUrl(listId)}/${encodeURIComponent(existing.id)}`,
      {
        method: "DELETE",
        redirect: "error",
        headers: graphHeaders(token.token),
      },
    );
    if (response.status !== 204) {
      throw new Error(
        `Microsoft Graph task removal returned HTTP ${response.status}.`,
      );
    }
    this.retained = undefined;
    return result("removed");
  }

  private async coryToken(): Promise<DelegatedGraphToken> {
    const token = await this.tokenProvider.getToken(
      GRAPH_TASKS_READ_WRITE_SCOPE,
    );
    if (
      !token?.token ||
      token.identity.tenantId !== this.cory.tenantId ||
      token.identity.objectId !== this.cory.objectId ||
      token.identity.userPrincipalName.toLowerCase() !==
        CORY_USER_PRINCIPAL_NAME
    ) {
      throw new Error("Delegated Graph token is not for Cory West.");
    }
    return token;
  }

  private async defaultListId(accessToken: string): Promise<string> {
    const response = await this.request(LISTS_URL, {
      method: "GET",
      redirect: "error",
      headers: graphHeaders(accessToken),
    });
    const body = await readJson(response);
    if (
      response.status !== 200 ||
      !isCollection(body) ||
      !body.value.every(isTaskList)
    ) {
      throw new TodoTaskProofConflictError();
    }
    const defaults = body.value.filter((list) =>
      list.isOwner === true &&
      list.isShared === false &&
      list.wellknownListName === "defaultList"
    );
    if (defaults.length !== 1) throw new TodoTaskProofConflictError();
    return defaults[0]!.id;
  }

  private async findExact(
    accessToken: string, listId: string,
  ): Promise<{ id: string } | undefined> {
    const response = await this.request(tasksUrl(listId), {
      method: "GET",
      redirect: "error",
      headers: graphHeaders(accessToken),
    });
    const body = await readJson(response);
    if (
      response.status !== 200 ||
      !isCollection(body) ||
      !body.value.every(isIdentifiableTask)
    ) {
      throw new TodoTaskProofConflictError();
    }
    const matches = body.value.filter((task) => task.title === TODO_TASK_TITLE);
    if (matches.length === 0) return undefined;
    if (matches.length !== 1 || !isExactTask(matches[0])) {
      throw new TodoTaskProofConflictError();
    }
    return { id: matches[0].id };
  }

  private retain(listId: string, taskId: string): void {
    if (
      this.retained &&
      (this.retained.listId !== listId || this.retained.taskId !== taskId)
    ) {
      throw new TodoTaskProofConflictError();
    }
    this.retained = { listId, taskId };
  }
}

function tasksUrl(listId: string): string {
  return `${LISTS_URL}/${encodeURIComponent(listId)}/tasks`;
}
function isCollection(value: unknown):
  value is { value: unknown[] } {
  return isRecord(value) &&
    !("@odata.nextLink" in value) &&
    Array.isArray(value.value);
}
function isTaskList(value: unknown):
  value is Record<string, unknown> & { id: string } {
  return isRecord(value) && typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.isOwner === "boolean" &&
    typeof value.isShared === "boolean" &&
    typeof value.wellknownListName === "string";
}
function isIdentifiableTask(value: unknown):
  value is Record<string, unknown> & { id: string; title: string } {
  return isRecord(value) && typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.title === "string";
}
function isExactTask(value: unknown):
  value is Record<string, unknown> & { id: string } {
  if (
    !isRecord(value) ||
    !isIdentifiableTask(value) ||
    value.title !== TODO_TASK_TITLE ||
    value.status !== "notStarted" ||
    value.importance !== "low" ||
    value.isReminderOn !== false ||
    !Array.isArray(value.categories) ||
    value.categories.length !== 0 ||
    value.hasAttachments !== false
  ) {
    return false;
  }
  return emptyBody(value.body) &&
    emptyOptional(value.dueDateTime) &&
    emptyOptional(value.startDateTime) &&
    emptyOptional(value.reminderDateTime) &&
    emptyOptional(value.recurrence) &&
    emptyOptional(value.completedDateTime) &&
    emptyArray(value.attachments) &&
    emptyArray(value.linkedResources);
}
function emptyBody(value: unknown): boolean {
  return value === undefined ||
    value === null ||
    (isRecord(value) && value.content === "");
}
function emptyOptional(value: unknown): boolean {
  return value === undefined || value === null;
}
function emptyArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}
function graphHeaders(token: string, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function result(state: TodoTaskProofResult["state"]): TodoTaskProofResult {
  return { state, title: TODO_TASK_TITLE };
}
