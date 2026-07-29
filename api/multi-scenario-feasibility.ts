import {
  ScenarioPlanError,
  compileScenarioExecutionPlan,
  type ScenarioExecutionPlan,
  type ScenarioPlanErrorCategory,
  type ScenarioPlanningRequest,
} from "../src/scenarios/scenario-plan.js";
import {
  MultiScenarioFeasibilityInputError,
  planMultiScenarioFeasibility,
} from "../src/scenarios/multi-scenario-feasibility.js";
import type {
  FeasibilityInputFailure,
  MultiScenarioFeasibilityRequest,
  MultiScenarioFeasibilityResult,
} from "../src/scenarios/multi-scenario-feasibility-contract.js";
import {
  BATCH_FEASIBILITY_MAX_RESPONSE_BYTES,
  BatchFeasibilityContractError,
  isSafeBatchFeasibilityResult,
  parseBatchFeasibilityEnvelope,
} from "../src/api/multi-scenario-feasibility-contract.js";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.js";

export const BATCH_FEASIBILITY_API_CAPABILITY = {
  schemaVersion: 1,
  surface: "authenticated-batch-feasibility-api",
  scenarioScope: "canonical-registry",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type BatchFeasibilityRefusalCategory =
  | ScenarioPlanErrorCategory
  | FeasibilityInputFailure;

export type BatchScenarioPlanCompiler = (
  request: ScenarioPlanningRequest,
) => ScenarioExecutionPlan;

export type BatchFeasibilityPlanner = (
  request: MultiScenarioFeasibilityRequest,
) => MultiScenarioFeasibilityResult;

export interface MultiScenarioFeasibilityService {
  calculate(value: unknown): MultiScenarioFeasibilityResult;
}

export class BatchFeasibilityRefusalError extends Error {
  readonly category: BatchFeasibilityRefusalCategory;

  constructor(category: BatchFeasibilityRefusalCategory) {
    super("Batch feasibility request was refused.");
    this.name = "BatchFeasibilityRefusalError";
    this.category = category;
  }
}

export class BatchFeasibilitySafeFailureError extends Error {
  constructor() {
    super("Batch feasibility calculation failed safely.");
    this.name = "BatchFeasibilitySafeFailureError";
  }
}

export class BatchFeasibilityResponseTooLargeError extends Error {
  constructor() {
    super("Batch feasibility response exceeded its safe bound.");
    this.name = "BatchFeasibilityResponseTooLargeError";
  }
}

export class InMemoryMultiScenarioFeasibilityService
  implements MultiScenarioFeasibilityService {
  private readonly compiler: BatchScenarioPlanCompiler;
  private readonly planner: BatchFeasibilityPlanner;

  constructor(
    compiler: BatchScenarioPlanCompiler =
      compileScenarioExecutionPlan,
    planner: BatchFeasibilityPlanner =
      planMultiScenarioFeasibility,
  ) {
    this.compiler = compiler;
    this.planner = planner;
  }

  calculate(value: unknown): MultiScenarioFeasibilityResult {
    try {
      const request = parseBatchFeasibilityEnvelope(value);
      const compiledRequest: MultiScenarioFeasibilityRequest = {
        schemaVersion: 1,
        label: "SCENARIO_FEASIBILITY_REQUEST",
        session: request.session,
        plans: request.plans.map(({ instanceAlias, planRequest }) => ({
          instanceAlias,
          plan: this.compiler(planRequest),
        })),
      };
      const result = this.planner(compiledRequest);
      const authoritativeResult =
        planMultiScenarioFeasibility(compiledRequest);
      if (
        !isSafeBatchFeasibilityResult(
          result,
          request,
          authoritativeResult,
        )
      ) {
        throw new BatchFeasibilitySafeFailureError();
      }
      if (
        Buffer.byteLength(JSON.stringify(result), "utf8") >
        BATCH_FEASIBILITY_MAX_RESPONSE_BYTES
      ) {
        throw new BatchFeasibilityResponseTooLargeError();
      }
      return result;
    } catch (error) {
      if (error instanceof BatchFeasibilityRefusalError) throw error;
      if (error instanceof BatchFeasibilitySafeFailureError) throw error;
      if (error instanceof BatchFeasibilityResponseTooLargeError) throw error;
      if (error instanceof ScenarioPlanError) {
        throw new BatchFeasibilityRefusalError(error.category);
      }
      if (error instanceof MultiScenarioFeasibilityInputError) {
        throw new BatchFeasibilityRefusalError(error.category);
      }
      if (error instanceof BatchFeasibilityContractError) {
        throw new BatchFeasibilityRefusalError(error.category);
      }
      throw new BatchFeasibilitySafeFailureError();
    }
  }
}
