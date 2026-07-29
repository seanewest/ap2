import {
  ScenarioPlanError,
  compileScenarioExecutionPlan,
  parseScenarioPlanningRequest,
  type ScenarioExecutionPlan,
  type ScenarioPlanningRequest,
} from "../src/scenarios/scenario-plan.js";

export const SCENARIO_PLAN_MAX_REQUEST_BYTES = 8_192;
export const SCENARIO_PLAN_MAX_RESPONSE_BYTES = 65_536;

export type ScenarioPlanCompiler = (
  request: ScenarioPlanningRequest,
) => ScenarioExecutionPlan;

export interface ScenarioPlanService {
  compile(value: unknown): ScenarioExecutionPlan;
}

export class ScenarioPlanSafeFailureError extends Error {
  constructor() {
    super("Scenario plan compilation failed safely.");
    this.name = "ScenarioPlanSafeFailureError";
  }
}

export class ScenarioPlanResponseTooLargeError extends Error {
  constructor() {
    super("Scenario plan response exceeded its safe bound.");
    this.name = "ScenarioPlanResponseTooLargeError";
  }
}

export class InMemoryScenarioPlanService implements ScenarioPlanService {
  constructor(
    private readonly compiler: ScenarioPlanCompiler =
      compileScenarioExecutionPlan,
  ) {}

  compile(value: unknown): ScenarioExecutionPlan {
    const request = parseScenarioPlanningRequest(value);
    let plan: ScenarioExecutionPlan;
    try {
      plan = this.compiler(request);
    } catch (error) {
      if (error instanceof ScenarioPlanError) {
        throw error;
      }
      throw new ScenarioPlanSafeFailureError();
    }

    if (
      Buffer.byteLength(JSON.stringify(plan), "utf8") >
      SCENARIO_PLAN_MAX_RESPONSE_BYTES
    ) {
      throw new ScenarioPlanResponseTooLargeError();
    }
    return plan;
  }
}
