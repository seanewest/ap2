// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  DelegatedGraphTodoTaskProof,
  GRAPH_TASKS_READ_WRITE_SCOPE,
  TODO_TASK_TITLE,
  TodoTaskProofConflictError,
} from "./todo-task-proof.js";
import { coryIdentity, type DelegatedGraphTokenProvider } from "./simulated-user.js";
const cory = coryIdentity("11111111-1111-4111-8111-111111111111");
const defaultList = {
  id: "default/list",
  isOwner: true,
  isShared: false,
  wellknownListName: "defaultList",
};
function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task/id",
    title: TODO_TASK_TITLE,
    status: "notStarted",
    importance: "low",
    isReminderOn: false,
    categories: [],
    hasAttachments: false,
    body: { content: "", contentType: "text" },
    dueDateTime: null,
    startDateTime: null,
    reminderDateTime: null,
    recurrence: null,
    completedDateTime: null,
    linkedResources: [],
    ...overrides,
  };
}
function fixture(responses: readonly Response[]) {
  const queue = [...responses];
  const request = vi.fn<typeof fetch>(async () => {
    const response = queue.shift();
    if (!response) throw new Error("Unexpected Graph request");
    return response;
  });
  const tokens = {
    getToken: vi.fn(async () => ({ token: "cory-task-token", identity: cory })),
  } satisfies DelegatedGraphTokenProvider;
  return {
    operation: new DelegatedGraphTodoTaskProof(tokens, cory, request),
    request,
    tokens,
  };
}
const lists = (value: unknown[] = [defaultList]) => Response.json({ value });
const tasks = (value: unknown[] = []) => Response.json({ value });
describe("DelegatedGraphTodoTaskProof", () => {
  it("uses two plain reads and creates one exact harmless task", async () => {
    const test = fixture([
      lists(),
      tasks([{ id: "unrelated", title: "Private unrelated task" }]),
      Response.json(task(), { status: 201 }),
    ]);
    await expect(test.operation.create()).resolves.toEqual(
      { state: "configured", title: TODO_TASK_TITLE },
    );
    expect(test.tokens.getToken).toHaveBeenCalledWith(GRAPH_TASKS_READ_WRITE_SCOPE);
    expect(test.request).toHaveBeenCalledTimes(3);
    expect(String(test.request.mock.calls[0]![0])).toBe(
      "https://graph.microsoft.com/v1.0/me/todo/lists",
    );
    expect(String(test.request.mock.calls[1]![0])).toBe(
      "https://graph.microsoft.com/v1.0/me/todo/lists/default%2Flist/tasks",
    );
    for (const call of test.request.mock.calls.slice(0, 2)) {
      expect(new URL(String(call[0])).search).toBe("");
      expect(call[1]).toMatchObject({ method: "GET", redirect: "error" });
    }
    const [url, init] = test.request.mock.calls[2]!;
    expect(String(url)).toContain("/default%2Flist/tasks");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer cory-task-token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      title: TODO_TASK_TITLE,
      status: "notStarted",
      importance: "low",
      isReminderOn: false,
      categories: [],
    });
    expect(Object.keys(JSON.parse(String(init?.body)))).not.toEqual(
      expect.arrayContaining([
        "body", "dueDateTime", "startDateTime", "reminderDateTime",
        "recurrence", "attachments", "linkedResources",
      ]),
    );
  });
  it("accepts one exact existing task without another mutation", async () => {
    const test = fixture([lists(), tasks([task()])]);
    await expect(test.operation.create()).resolves.toMatchObject(
      { state: "configured" },
    );
    expect(test.request).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["paginated lists", { value: [defaultList], "@odata.nextLink": "next" }],
    ["no default list", { value: [{ ...defaultList, wellknownListName: "none" }] }],
    ["shared default", { value: [{ ...defaultList, isShared: true }] }],
    ["multiple defaults", { value: [defaultList, { ...defaultList, id: "two" }] }],
    ["malformed unrelated list", { value: [defaultList, null] }],
  ])("refuses %s before reading tasks", async (_case, body) => {
    const test = fixture([Response.json(body)]);
    await expect(test.operation.create()).rejects.toBeInstanceOf(
      TodoTaskProofConflictError,
    );
    expect(test.request).toHaveBeenCalledOnce();
  });
  it.each([
    ["pagination", { value: [], "@odata.nextLink": "next" }],
    ["duplicates", { value: [task(), task({ id: "two" })] }],
    ["malformed unrelated task", { value: [null] }],
    ["wrong status", { value: [task({ status: "completed" })] }],
    ["wrong importance", { value: [task({ importance: "high" })] }],
    ["reminder", { value: [task({ isReminderOn: true })] }],
    ["category", { value: [task({ categories: ["Private"] })] }],
    ["attachment", { value: [task({ hasAttachments: true })] }],
    ["body", { value: [task({ body: { content: "Private" } })] }],
    ["due date", { value: [task({ dueDateTime: { dateTime: "soon" } })] }],
    ["linked resource", { value: [task({ linkedResources: [{}] })] }],
  ])("refuses %s task state without mutation", async (_case, body) => {
    const test = fixture([lists(), Response.json(body)]);
    await expect(test.operation.create()).rejects.toBeInstanceOf(
      TodoTaskProofConflictError,
    );
    expect(test.request).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["wrong status code", task(), 200],
    ["wrong title", task({ title: "wrong" }), 201],
    ["completed", task({ status: "completed" }), 201],
    ["attachment", task({ hasAttachments: true }), 201],
  ])("does not retry an unconfirmed create: %s", async (_case, body, status) => {
    const test = fixture([
      lists(),
      tasks(),
      Response.json(body, { status }),
    ]);
    await expect(test.operation.create()).rejects.toThrow("unconfirmed");
    expect(test.request).toHaveBeenCalledTimes(3);
  });
  it("removes one exact task, and absence is already removed", async () => {
    const remove = fixture([
      lists(),
      tasks([task()]),
      new Response(undefined, { status: 204 }),
    ]);
    await expect(remove.operation.remove()).resolves.toEqual({
      state: "removed",
      title: TODO_TASK_TITLE,
    });
    expect(remove.request.mock.calls[2]).toMatchObject([
      "https://graph.microsoft.com/v1.0/me/todo/lists/default%2Flist/tasks/task%2Fid",
      { method: "DELETE", redirect: "error" },
    ]);
    const absent = fixture([lists(), tasks()]);
    await expect(absent.operation.remove()).resolves.toMatchObject({
      state: "removed",
    });
    expect(absent.request).toHaveBeenCalledTimes(2);
  });
  it.each(["create", "remove"] as const)(
    "refuses retained + absent on %s without another mutation",
    async (action) => {
      const test = fixture([
        lists(), tasks(), Response.json(task(), { status: 201 }),
        lists(), tasks(),
      ]);
      await test.operation.create();
      await expect(test.operation[action]()).rejects.toBeInstanceOf(
        TodoTaskProofConflictError,
      );
      expect(test.request).toHaveBeenCalledTimes(5);
    },
  );
  it.each(["create", "remove"] as const)(
    "refuses a retained list move on %s before reading tasks",
    async (action) => {
      const test = fixture([
        lists(), tasks(), Response.json(task(), { status: 201 }),
        lists([{ ...defaultList, id: "changed" }]),
      ]);
      await test.operation.create();
      await expect(test.operation[action]()).rejects.toBeInstanceOf(
        TodoTaskProofConflictError,
      );
      expect(test.request).toHaveBeenCalledTimes(4);
    },
  );
  it.each(["create", "remove"] as const)(
    "refuses a retained task identity mismatch on %s without mutation",
    async (action) => {
      const test = fixture([
        lists(), tasks(), Response.json(task(), { status: 201 }),
        lists(), tasks([task({ id: "moved" })]),
      ]);
      await test.operation.create();
      await expect(test.operation[action]()).rejects.toBeInstanceOf(
        TodoTaskProofConflictError,
      );
      expect(test.request).toHaveBeenCalledTimes(5);
    },
  );
  it("never retries failed deletion", async () => {
    const failed = fixture([
      lists(),
      tasks([task()]),
      new Response(undefined, { status: 503 }),
    ]);
    await expect(failed.operation.remove()).rejects.toThrow("HTTP 503");
    expect(failed.request).toHaveBeenCalledTimes(3);
  });
  it("never queries Graph with another identity's token", async () => {
    const test = fixture([]);
    test.tokens.getToken.mockResolvedValue({
      token: "wrong",
      identity: { ...cory, objectId: "wrong" },
    });
    await expect(test.operation.create()).rejects.toThrow("not for Cory");
    expect(test.request).not.toHaveBeenCalled();
  });
});
