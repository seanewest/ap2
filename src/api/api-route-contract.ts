export const API_AUTHORIZATION_CLASSES = ["public", "operator"] as const;
export type ApiAuthorizationClass =
  (typeof API_AUTHORIZATION_CLASSES)[number];

export const API_SIDE_EFFECT_CLASSES = [
  "pure",
  "read-only-external",
  "bounded-mutation",
] as const;
export type ApiSideEffectClass = typeof API_SIDE_EFFECT_CLASSES[number];

export const API_ROUTE_METHODS = ["GET", "POST", "DELETE"] as const;
export type ApiRouteMethod = typeof API_ROUTE_METHODS[number];

interface ApiRouteContractShape<OwnerKey extends string = string> {
  schemaVersion: 1;
  method: ApiRouteMethod;
  path: string;
  authorization: ApiAuthorizationClass;
  authBeforeBody: boolean;
  requestContent: "none" | "json";
  requestMaxBytes: number;
  responseMaxBytes: number;
  errorMaxBytes: number;
  sideEffect: ApiSideEffectClass;
  externalCall: boolean;
  persistence: boolean;
  retry: boolean;
  scheduling: boolean;
  ownerKey: OwnerKey;
}

const PURE = {
  sideEffect: "pure",
  externalCall: false,
  persistence: false,
  retry: false,
  scheduling: false,
} as const;
const READ_ONLY_EXTERNAL = {
  sideEffect: "read-only-external",
  externalCall: true,
  persistence: false,
  retry: false,
  scheduling: false,
} as const;
const BOUNDED_MUTATION = {
  sideEffect: "bounded-mutation",
  externalCall: true,
  persistence: true,
  retry: false,
  scheduling: false,
} as const;
const OPERATOR_NONE = {
  authorization: "operator",
  authBeforeBody: true,
  requestContent: "none",
  requestMaxBytes: 0,
} as const;
const MUTATION_RESPONSE = {
  responseMaxBytes: 8_192,
  errorMaxBytes: 4_096,
} as const;

export const API_ROUTE_CONTRACTS = [
  route("GET", "/health", "health", {
    authorization: "public",
    authBeforeBody: false,
    requestContent: "none",
    requestMaxBytes: 0,
    responseMaxBytes: 256,
    errorMaxBytes: 1_024,
    ...PURE,
  }),
  route("GET", "/api/whoami", "whoami", {
    ...OPERATOR_NONE,
    responseMaxBytes: 1_024,
    errorMaxBytes: 1_024,
    ...PURE,
  }),
  route("GET", "/api/rehearsal-status", "rehearsal-status", {
    ...OPERATOR_NONE,
    responseMaxBytes: 4_096,
    errorMaxBytes: 1_024,
    ...READ_ONLY_EXTERNAL,
  }),
  route("GET", "/api/operation-events", "operation-events", {
    ...OPERATOR_NONE,
    responseMaxBytes: 16_384,
    errorMaxBytes: 1_024,
    ...PURE,
  }),
  route("POST", "/api/simulated-email", "simulated-email-send", {
    ...OPERATOR_NONE,
    ...MUTATION_RESPONSE,
    ...BOUNDED_MUTATION,
  }),
  route("POST", "/api/help-desk-scenario", "help-desk-scenario-send", {
    ...OPERATOR_NONE,
    ...MUTATION_RESPONSE,
    ...BOUNDED_MUTATION,
  }),
  route("POST", "/api/scenario-plan", "scenario-plan-compile", {
    ...jsonRequest(8_192),
    responseMaxBytes: 65_536,
    errorMaxBytes: 1_024,
    ...PURE,
  }),
  route(
    "POST",
    "/api/scenario-evidence-verification",
    "scenario-receipt-verify",
    {
      ...jsonRequest(131_072),
      responseMaxBytes: 131_072,
      errorMaxBytes: 1_024,
      ...PURE,
    },
  ),
  route(
    "POST",
    "/api/rehearsal-output-verification",
    "avd-rehearsal-verify",
    {
      ...jsonRequest(32_768),
      responseMaxBytes: 4_096,
      errorMaxBytes: 1_024,
      ...PURE,
    },
  ),
  route(
    "POST",
    "/api/private-document-rehearsal-verification",
    "private-document-rehearsal-verify",
    {
      ...jsonRequest(32_768),
      responseMaxBytes: 4_096,
      errorMaxBytes: 1_024,
      ...PURE,
    },
  ),
  route(
    "POST",
    "/api/help-desk-email-rehearsal-verification",
    "help-desk-email-rehearsal-verify",
    {
      ...jsonRequest(32_768),
      responseMaxBytes: 4_096,
      errorMaxBytes: 1_024,
      ...PURE,
    },
  ),
  route(
    "POST",
    "/api/teams-missed-call-rehearsal-verification",
    "teams-missed-call-rehearsal-verify",
    {
      ...jsonRequest(32_768),
      responseMaxBytes: 4_096,
      errorMaxBytes: 1_024,
      ...PURE,
    },
  ),
  route(
    "POST",
    "/api/oauth-application-recon-rehearsal-verification",
    "oauth-application-recon-rehearsal-verify",
    {
      ...jsonRequest(32_768),
      responseMaxBytes: 4_096,
      errorMaxBytes: 1_024,
      ...PURE,
    },
  ),
  route(
    "POST",
    "/api/multi-scenario-feasibility",
    "batch-feasibility-calculate",
    {
      ...jsonRequest(65_536),
      responseMaxBytes: 4_096,
      errorMaxBytes: 1_024,
      ...PURE,
    },
  ),
  ...mutationPair("/api/onedrive-share-proof", "onedrive-proof"),
  ...mutationPair("/api/contact-proof", "contact-proof"),
  ...mutationPair("/api/inbox-rule-proof", "inbox-rule-proof"),
  ...mutationPair("/api/category-proof", "category-proof"),
  ...mutationPair("/api/sharepoint-file-proof", "sharepoint-file-proof"),
  ...mutationPair("/api/draft-proof", "draft-proof"),
  ...mutationPair("/api/todo-task-proof", "todo-task-proof"),
  route("POST", "/api/calendar-meeting", "calendar-meeting-create", {
    ...OPERATOR_NONE,
    ...MUTATION_RESPONSE,
    ...BOUNDED_MUTATION,
  }),
  route(
    "POST",
    "/api/calendar-meeting/cancel",
    "calendar-meeting-cancel",
    {
      ...OPERATOR_NONE,
      ...MUTATION_RESPONSE,
      ...BOUNDED_MUTATION,
    },
  ),
] as const satisfies readonly ApiRouteContractShape[];

export type ApiRouteOwnerKey =
  (typeof API_ROUTE_CONTRACTS)[number]["ownerKey"];
export type ApiRouteContract = ApiRouteContractShape<ApiRouteOwnerKey>;
export const API_ROUTE_OWNER_KEYS = Object.freeze(
  API_ROUTE_CONTRACTS.map(({ ownerKey }) => ownerKey),
);

export const API_ROUTE_CONTRACT_FAILURES = [
  "AUTH_BODY_POLICY",
  "BOUNDS_INVALID",
  "DUPLICATE_METHOD_PATH",
  "DUPLICATE_OWNER",
  "EXTERNAL_POLICY",
  "INPUT_SHAPE",
  "MUTATION_RETRY",
  "OWNER_COVERAGE",
  "PERSISTENCE_POLICY",
  "PURE_SIDE_EFFECT",
  "SCHEDULING_POLICY",
] as const;
export type ApiRouteContractFailure =
  (typeof API_ROUTE_CONTRACT_FAILURES)[number];

export interface ApiRouteContractInventory {
  schemaVersion: 1;
  label: "API_ROUTE_CONTRACT_INVENTORY";
  status: "valid" | "invalid";
  routes: readonly ApiRouteContract[];
  failures: readonly Readonly<{
    ownerKey: string;
    category: ApiRouteContractFailure;
  }>[];
}

export function inventoryApiRouteContracts(
  candidates: readonly unknown[] = API_ROUTE_CONTRACTS,
): ApiRouteContractInventory {
  const routes: ApiRouteContract[] = [];
  const failures: Array<{
    ownerKey: string;
    category: ApiRouteContractFailure;
  }> = [];
  const methodPaths = new Set<string>();
  const owners = new Set<string>();
  if (!Array.isArray(candidates) || candidates.length > 64) {
    addFailure(failures, "inventory", "INPUT_SHAPE");
  } else {
    for (const candidate of candidates) {
      const parsed = parseRoute(candidate, failures);
      if (!parsed) continue;
      const methodPath = `${parsed.method} ${parsed.path}`;
      if (methodPaths.has(methodPath)) {
        addFailure(failures, parsed.ownerKey, "DUPLICATE_METHOD_PATH");
      }
      if (owners.has(parsed.ownerKey)) {
        addFailure(failures, parsed.ownerKey, "DUPLICATE_OWNER");
      }
      methodPaths.add(methodPath);
      owners.add(parsed.ownerKey);
      routes.push(parsed);
    }
  }
  for (const ownerKey of API_ROUTE_OWNER_KEYS) {
    if (!owners.has(ownerKey)) {
      addFailure(failures, ownerKey, "OWNER_COVERAGE");
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    label: "API_ROUTE_CONTRACT_INVENTORY",
    status: failures.length === 0 ? "valid" : "invalid",
    routes: Object.freeze(routes),
    failures: Object.freeze(failures),
  });
}

export function apiRouteContract(
  ownerKey: ApiRouteOwnerKey,
): ApiRouteContract {
  const contract = API_ROUTE_CONTRACTS.find(
    (candidate) => candidate.ownerKey === ownerKey,
  );
  if (!contract) throw new TypeError("API route owner is undeclared.");
  return contract;
}

export function findApiRouteContract(
  method: string | undefined,
  path: string,
): ApiRouteContract | undefined {
  return API_ROUTE_CONTRACTS.find(
    (contract) => contract.method === method && contract.path === path,
  );
}

export function apiRouteContractsForPath(
  path: string,
): readonly ApiRouteContract[] {
  return API_ROUTE_CONTRACTS.filter((contract) => contract.path === path);
}

function route<OwnerKey extends string>(
  method: ApiRouteMethod,
  path: string,
  ownerKey: OwnerKey,
  rest: Omit<
    ApiRouteContractShape,
    "schemaVersion" | "method" | "path" | "ownerKey"
  >,
): ApiRouteContractShape<OwnerKey> {
  return Object.freeze({
    schemaVersion: 1,
    method,
    path,
    ...rest,
    ownerKey,
  });
}

function jsonRequest(maximumBytes: number) {
  return {
    authorization: "operator",
    authBeforeBody: true,
    requestContent: "json",
    requestMaxBytes: maximumBytes,
  } as const;
}

function mutationPair<
  OwnerPrefix extends
    | "onedrive-proof"
    | "contact-proof"
    | "inbox-rule-proof"
    | "category-proof"
    | "sharepoint-file-proof"
    | "draft-proof"
    | "todo-task-proof",
>(
  path: string,
  ownerPrefix: OwnerPrefix,
): readonly [
  ApiRouteContractShape<`${OwnerPrefix}-create`>,
  ApiRouteContractShape<`${OwnerPrefix}-remove`>,
] {
  return [
    route("POST", path, `${ownerPrefix}-create`, {
      ...OPERATOR_NONE,
      ...MUTATION_RESPONSE,
      ...BOUNDED_MUTATION,
    }),
    route("DELETE", path, `${ownerPrefix}-remove`, {
      ...OPERATOR_NONE,
      ...MUTATION_RESPONSE,
      ...BOUNDED_MUTATION,
    }),
  ];
}

function parseRoute(
  candidate: unknown,
  failures: Array<{
    ownerKey: string;
    category: ApiRouteContractFailure;
  }>,
): ApiRouteContract | undefined {
  const owner = isRecord(candidate) && typeof candidate.ownerKey === "string"
    ? candidate.ownerKey
    : "unknown";
  if (
    !isRecord(candidate) ||
    Object.keys(candidate).length !== 15 ||
    ![
      "schemaVersion",
      "method",
      "path",
      "authorization",
      "authBeforeBody",
      "requestContent",
      "requestMaxBytes",
      "responseMaxBytes",
      "errorMaxBytes",
      "sideEffect",
      "externalCall",
      "persistence",
      "retry",
      "scheduling",
      "ownerKey",
    ].every((key, index) => Object.keys(candidate)[index] === key) ||
    candidate.schemaVersion !== 1 ||
    !API_ROUTE_METHODS.includes(candidate.method as ApiRouteMethod) ||
    typeof candidate.path !== "string" ||
    !/^\/(?:health|api\/[a-z][a-z0-9/-]{0,95})$/.test(candidate.path) ||
    !API_AUTHORIZATION_CLASSES.includes(
      candidate.authorization as ApiAuthorizationClass,
    ) ||
    typeof candidate.authBeforeBody !== "boolean" ||
    (candidate.requestContent !== "none" &&
      candidate.requestContent !== "json") ||
    !API_SIDE_EFFECT_CLASSES.includes(
      candidate.sideEffect as ApiSideEffectClass,
    ) ||
    ![
      candidate.externalCall,
      candidate.persistence,
      candidate.retry,
      candidate.scheduling,
    ].every((value) => typeof value === "boolean") ||
    !API_ROUTE_OWNER_KEYS.includes(candidate.ownerKey as ApiRouteOwnerKey)
  ) {
    addFailure(failures, owner, "INPUT_SHAPE");
    return undefined;
  }
  const route = candidate as unknown as ApiRouteContract;
  if (
    route.authorization === "operator" !== route.authBeforeBody ||
    (route.requestContent === "json" && route.authorization !== "operator")
  ) {
    addFailure(failures, owner, "AUTH_BODY_POLICY");
  }
  if (
    !bounded(route.requestMaxBytes, 0, 1_048_576) ||
    !bounded(route.responseMaxBytes, 64, 1_048_576) ||
    !bounded(route.errorMaxBytes, 64, 16_384) ||
    (route.requestContent === "none" && route.requestMaxBytes !== 0) ||
    (route.requestContent === "json" && route.requestMaxBytes === 0)
  ) {
    addFailure(failures, owner, "BOUNDS_INVALID");
  }
  if (
    route.sideEffect === "pure" &&
    (route.externalCall || route.persistence || route.retry || route.scheduling)
  ) {
    addFailure(failures, owner, "PURE_SIDE_EFFECT");
  }
  if (
    route.sideEffect === "read-only-external" &&
    !route.externalCall
  ) {
    addFailure(failures, owner, "EXTERNAL_POLICY");
  }
  if (
    route.sideEffect !== "bounded-mutation" &&
    route.persistence
  ) {
    addFailure(failures, owner, "PERSISTENCE_POLICY");
  }
  if (route.sideEffect === "bounded-mutation") {
    if (!route.externalCall) {
      addFailure(failures, owner, "EXTERNAL_POLICY");
    }
    if (!route.persistence) {
      addFailure(failures, owner, "PERSISTENCE_POLICY");
    }
    if (route.retry) addFailure(failures, owner, "MUTATION_RETRY");
  }
  if (route.scheduling) {
    addFailure(failures, owner, "SCHEDULING_POLICY");
  }
  return Object.freeze({ ...route });
}

function bounded(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function addFailure(
  failures: Array<{
    ownerKey: string;
    category: ApiRouteContractFailure;
  }>,
  ownerKey: string,
  category: ApiRouteContractFailure,
): void {
  failures.push(Object.freeze({ ownerKey, category }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const inventory = inventoryApiRouteContracts();
if (inventory.status !== "valid") {
  throw new Error("Authoritative API route contracts are invalid.");
}
