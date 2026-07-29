import { createStatus } from "../ui/elements";
import {
  type ScenarioInventorySurface,
  type ScenarioSurfaceCell,
  type ScenarioSurfaceInventory,
} from "./scenario-surface-inventory";
import {
  browserScenarioSurfaceInventory,
} from "./scenario-surface-matrix-data";

const MATRIX_COLUMNS = [
  {
    label: "Manifest / plan",
    surfaces: ["manifest", "plan"],
  },
  {
    label: "Adapter",
    surfaces: ["adapter"],
  },
  {
    label: "Rehearsal",
    surfaces: ["rehearsal"],
  },
  {
    label: "Offline verifier",
    surfaces: ["offline-rehearsal-verifier"],
  },
  {
    label: "Authenticated verification API / client",
    surfaces: ["authenticated-rehearsal-verification-api-client"],
  },
  {
    label: "Manual panel",
    surfaces: ["manual-rehearsal-verification-panel"],
  },
  {
    label: "Learner briefing",
    surfaces: ["learner-evidence-ui"],
  },
] as const satisfies readonly {
  label: string;
  surfaces: readonly ScenarioInventorySurface[];
}[];

export function createScenarioSurfaceMatrix(
  inventory: ScenarioSurfaceInventory =
    browserScenarioSurfaceInventory(),
): HTMLElement {
  const section = document.createElement("section");
  section.className = "scenario-surface-matrix";
  section.setAttribute("aria-labelledby", "scenario-surface-matrix-heading");

  const heading = document.createElement("h2");
  heading.id = "scenario-surface-matrix-heading";
  heading.textContent = "Scenario surface availability";
  section.append(
    heading,
    createStatus(
      "This matrix reports product-source surface availability only. It is not external evidence, scenario readiness, tenant state, or proof that any operation, observation, verification, or cleanup occurred.",
      "notice",
    ),
  );

  if (
    inventory.status !== "valid" ||
    inventory.failures.length > 0 ||
    inventory.scenarios.length === 0
  ) {
    section.append(
      createStatus(
        "Scenario surface inventory unavailable: authoritative inventory validation failed. No partial matrix was rendered.",
        "error",
      ),
    );
    return section;
  }

  const legend = document.createElement("p");
  legend.className = "scenario-surface-matrix-legend";
  legend.textContent =
    "Implemented means the repository surface is exported. Missing means it is not exported and is not a failure. Deliberately absent means the inventory marks it not applicable. Pending is distinct from missing; the authoritative inventory currently declares no pending state.";

  const tableWrap = document.createElement("div");
  tableWrap.className = "scenario-surface-matrix-table-wrap";
  tableWrap.tabIndex = 0;
  tableWrap.setAttribute(
    "aria-label",
    "Scrollable scenario surface availability matrix",
  );
  const table = document.createElement("table");
  const caption = document.createElement("caption");
  caption.textContent =
    "Authoritative repository surface status for every canonical scenario family";
  const head = document.createElement("thead");
  const headingRow = document.createElement("tr");
  headingRow.append(columnHeading("Scenario family"));
  for (const column of MATRIX_COLUMNS) {
    headingRow.append(columnHeading(column.label));
  }
  head.append(headingRow);

  const body = document.createElement("tbody");
  for (const row of inventory.scenarios) {
    const tableRow = document.createElement("tr");
    const scenario = document.createElement("th");
    scenario.scope = "row";
    const code = document.createElement("code");
    code.textContent = row.scenarioId;
    scenario.append(code);
    tableRow.append(scenario);
    for (const column of MATRIX_COLUMNS) {
      const cell = document.createElement("td");
      for (const surface of column.surfaces) {
        cell.append(status(row.surfaces[surface], surface));
      }
      tableRow.append(cell);
    }
    body.append(tableRow);
  }
  table.append(caption, head, body);
  tableWrap.append(table);
  section.append(legend, tableWrap);
  return section;
}

function columnHeading(label: string): HTMLTableCellElement {
  const heading = document.createElement("th");
  heading.scope = "col";
  heading.textContent = label;
  return heading;
}

function status(
  cell: ScenarioSurfaceCell,
  surface: ScenarioInventorySurface,
): HTMLElement {
  const value = document.createElement("span");
  value.className = `scenario-surface-status status-${cell.status}`;
  value.dataset.surface = surface;
  const prefix = surface === "manifest"
    ? "Manifest: "
    : surface === "plan"
    ? "Plan: "
    : "";
  value.textContent = `${prefix}${statusLabel(cell.status)}`;
  return value;
}

function statusLabel(status: ScenarioSurfaceCell["status"]): string {
  switch (status) {
    case "implemented":
      return "Implemented";
    case "missing":
      return "Missing — not a failure";
    case "not-applicable":
      return "Deliberately absent";
  }
}
