import type {
  OperationEvent,
  RecentOperationEvents,
} from "../api/client";
import { appendIdentity, createButton, createStatus } from "../ui/elements";

export type RecentOperationsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; snapshot: RecentOperationEvents }
  | { kind: "cancelled" }
  | { kind: "unauthorized" }
  | { kind: "error" };

export function createRecentOperationsPanel(
  state: RecentOperationsState,
  anotherApiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "recent-operations";
  panel.setAttribute("aria-labelledby", "recent-operations-heading");

  const heading = document.createElement("h2");
  heading.id = "recent-operations-heading";
  heading.textContent = "Recent operations";
  const disclosure = document.createElement("p");
  disclosure.className = "recent-operations-disclosure";
  disclosure.textContent =
    "Events are held only in this API process and disappear when it restarts. Newest events appear first.";
  const bounds = document.createElement("p");
  bounds.className = "recent-operations-disclosure";
  bounds.textContent =
    "A snapshot contains at most 64 events. Older events may also be omitted to keep the response within 16 KiB.";
  panel.append(heading, disclosure, bounds);

  if (state.kind === "loading") {
    panel.setAttribute("aria-busy", "true");
    panel.append(createStatus("Loading recent operations…"));
  } else if (state.kind === "success") {
    panel.append(createSnapshot(state.snapshot));
  } else if (state.kind === "cancelled") {
    panel.append(
      createStatus(
        "The refresh was cancelled before recent operations were requested.",
        "notice",
      ),
    );
  } else if (state.kind === "unauthorized") {
    panel.append(
      createStatus(
        "Your API session expired or this account is not authorized. Sign in again, then refresh.",
        "error",
      ),
    );
  } else if (state.kind === "error") {
    panel.append(
      createStatus(
        "Recent operations could not be loaded. No event details were returned.",
        "error",
      ),
    );
  } else {
    panel.append(
      createStatus("Select Refresh to load recent operations."),
    );
  }

  panel.append(
    createButton(
      "Refresh recent operations",
      "refresh-recent-operations",
      "secondary",
      anotherApiOperationLoading || state.kind === "loading",
    ),
  );
  return panel;
}

function createSnapshot(snapshot: RecentOperationEvents): HTMLElement {
  const content = document.createElement("div");
  if (snapshot.events.length === 0) {
    content.append(
      createStatus("No recent operations are available in this API process."),
    );
    return content;
  }

  content.append(
    createStatus(
      snapshot.events.length === 64
        ? "Showing the newest 64 events, the collector capacity."
        : `Showing ${snapshot.events.length} recent ${
            snapshot.events.length === 1 ? "event" : "events"
          }.`,
    ),
  );
  const list = document.createElement("ol");
  list.className = "operation-event-list";
  for (const event of snapshot.events) {
    const item = document.createElement("li");
    item.className = `operation-event operation-event--${event.outcome}`;
    item.append(createEventDetails(event));
    list.append(item);
  }
  content.append(list);
  return content;
}

function createEventDetails(event: OperationEvent): HTMLDListElement {
  const details = document.createElement("dl");
  details.className = "operation-event-details";
  appendIdentity(details, "Operation", operationLabel(event.operationKind));
  appendIdentity(details, "Phase", fixedLabel(event.phase));
  appendIdentity(details, "Outcome", fixedLabel(event.outcome));
  appendIdentity(details, "Reason", reasonLabel(event.reason));
  appendIdentity(details, "Ambiguity", ambiguityLabel(event.ambiguityState));
  appendIdentity(details, "Recovery", recoveryLabel(event.recoveryState));
  appendIdentity(details, "Duration", durationLabel(event.durationMs));
  if (event.upstreamStatus !== undefined) {
    appendIdentity(details, "HTTP status", String(event.upstreamStatus));
  }
  return details;
}

function operationLabel(value: OperationEvent["operationKind"]): string {
  return value === "calendar.create"
    ? "Calendar create"
    : "Calendar cancel";
}

function fixedLabel(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function reasonLabel(value: OperationEvent["reason"]): string {
  return value === "none" ? "None" : fixedLabel(value);
}

function ambiguityLabel(value: OperationEvent["ambiguityState"]): string {
  return value === "none" ? "None" : fixedLabel(value);
}

function recoveryLabel(value: OperationEvent["recoveryState"]): string {
  return fixedLabel(value);
}

function durationLabel(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${durationMs} ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(1)} seconds`;
  }
  if (durationMs < 3_600_000) {
    return `${(durationMs / 60_000).toFixed(1)} minutes`;
  }
  return `${(durationMs / 3_600_000).toFixed(1)} hours`;
}
