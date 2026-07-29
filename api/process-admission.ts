import type { ApiRouteContract } from "../src/api/api-route-contract.js";

export const API_PROCESS_ADMISSION_LIMITS = Object.freeze({
  control: 8,
  operatorTotal: 24,
  purePerRoute: 8,
  readOnlyExternalPerRoute: 4,
  boundedMutationPerRoute: 1,
});

export type ApiProcessAdmissionSnapshot = Readonly<{
  control: number;
  operator: number;
  routeKeys: number;
}>;

/**
 * One-replica overload boundary. It rejects immediately and never queues,
 * retries, or claims protection across processes or replicas.
 */
export class ProcessLocalApiAdmission {
  #control = 0;
  #operator = 0;
  readonly #routes = new Map<string, number>();

  tryAcquire(contract: ApiRouteContract | undefined): (() => void) | undefined {
    if (!contract || contract.authorization === "public") {
      if (this.#control >= API_PROCESS_ADMISSION_LIMITS.control) {
        return undefined;
      }
      this.#control += 1;
      return once(() => {
        this.#control -= 1;
      });
    }

    const key = admissionKey(contract);
    const active = this.#routes.get(key) ?? 0;
    if (
      this.#operator >= API_PROCESS_ADMISSION_LIMITS.operatorTotal ||
      active >= routeLimit(contract)
    ) {
      return undefined;
    }
    this.#operator += 1;
    this.#routes.set(key, active + 1);
    return once(() => {
      this.#operator -= 1;
      const remaining = (this.#routes.get(key) ?? 1) - 1;
      if (remaining === 0) {
        this.#routes.delete(key);
      } else {
        this.#routes.set(key, remaining);
      }
    });
  }

  snapshot(): ApiProcessAdmissionSnapshot {
    return Object.freeze({
      control: this.#control,
      operator: this.#operator,
      routeKeys: this.#routes.size,
    });
  }
}

function admissionKey(contract: ApiRouteContract): string {
  return `${contract.sideEffect}:${contract.method}:${contract.path}`;
}

function routeLimit(contract: ApiRouteContract): number {
  switch (contract.sideEffect) {
    case "pure":
      return API_PROCESS_ADMISSION_LIMITS.purePerRoute;
    case "read-only-external":
      return API_PROCESS_ADMISSION_LIMITS.readOnlyExternalPerRoute;
    case "bounded-mutation":
      return API_PROCESS_ADMISSION_LIMITS.boundedMutationPerRoute;
  }
}

function once(callback: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    callback();
  };
}
