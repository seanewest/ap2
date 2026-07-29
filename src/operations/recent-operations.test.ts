import { describe, expect, it } from "vitest";
import type { OperationEvent } from "../api/client";
import {
  createRecentOperationsPanel,
  type RecentOperationsState,
} from "./recent-operations";

const event: OperationEvent = {
  schemaVersion: 1,
  markerHash: "m1_0123456789abcdef01234567",
  operationKind: "calendar.cancel",
  phase: "recovery",
  outcome: "ambiguous",
  durationMs: 1_250,
  reason: "upstream-unavailable",
  ambiguityState: "possible-mutation",
  recoveryState: "unresolved",
  upstreamStatus: 503,
};

function render(state: RecentOperationsState): HTMLElement {
  const panel = createRecentOperationsPanel(state, false);
  document.body.replaceChildren(panel);
  return panel;
}

describe("Recent operations panel", () => {
  it("starts with a manual refresh and no automatic activity claim", () => {
    const panel = render({ kind: "idle" });
    expect(panel.textContent).toContain("Recent operations");
    expect(panel.textContent).toContain("Select Refresh");
    expect(panel.textContent).toContain(
      "Events are held only in this API process and disappear when it restarts.",
    );
    expect(panel.textContent).toContain(
      "A snapshot contains at most 64 events. Older events may also be omitted to keep the response within 16 KiB.",
    );
    expect(
      panel.querySelector<HTMLButtonElement>(
        "[data-action='refresh-recent-operations']",
      )?.disabled,
    ).toBe(false);
  });

  it("renders an accessible loading state with refresh disabled", () => {
    const panel = render({ kind: "loading" });
    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(panel.textContent).toContain("Loading recent operations");
    expect(panel.querySelector("button")?.disabled).toBe(true);
  });

  it("explains an empty process-local snapshot", () => {
    const panel = render({
      kind: "success",
      snapshot: { schemaVersion: 1, order: "newest", events: [] },
    });
    expect(panel.textContent).toContain(
      "No recent operations are available in this API process.",
    );
  });

  it("renders only fixed safe labels and never renders the marker hash", () => {
    const panel = render({
      kind: "success",
      snapshot: { schemaVersion: 1, order: "newest", events: [event] },
    });
    for (const text of [
      "Calendar cancel",
      "Recovery",
      "Ambiguous",
      "Upstream Unavailable",
      "Possible Mutation",
      "Unresolved",
      "1.3 seconds",
      "503",
    ]) {
      expect(panel.textContent).toContain(text);
    }
    expect(panel.textContent).not.toContain(event.markerHash);
    expect(panel.textContent).not.toMatch(
      /tenant|object id|message body|token|payload/i,
    );
    expect(
      [...panel.querySelectorAll("dt")].map(({ textContent }) => textContent),
    ).toEqual([
      "Operation",
      "Phase",
      "Outcome",
      "Reason",
      "Ambiguity",
      "Recovery",
      "Duration",
      "HTTP status",
    ]);
  });

  it("labels the exact collector capacity without inventing pagination", () => {
    const events = Array.from({ length: 64 }, () => ({ ...event }));
    const panel = render({
      kind: "success",
      snapshot: { schemaVersion: 1, order: "newest", events },
    });
    expect(panel.textContent).toContain(
      "Showing the newest 64 events, the collector capacity.",
    );
    expect(panel.querySelectorAll(".operation-event")).toHaveLength(64);
    expect(panel.textContent).not.toMatch(/next page|load more/i);
  });

  it("discloses the response-size bound for a smaller snapshot", () => {
    const panel = render({
      kind: "success",
      snapshot: {
        schemaVersion: 1,
        order: "newest",
        events: Array.from({ length: 40 }, () => ({ ...event })),
      },
    });
    expect(panel.textContent).toContain("Showing 40 recent events.");
    expect(panel.textContent).toContain(
      "Older events may also be omitted to keep the response within 16 KiB.",
    );
  });

  it.each([
    [{ kind: "cancelled" }, "cancelled before recent operations were requested"],
    [
      { kind: "unauthorized" },
      "session expired or this account is not authorized",
    ],
    [
      { kind: "error" },
      "Recent operations could not be loaded. No event details were returned.",
    ],
  ] as const)("renders a safe %s state", (state, message) => {
    const panel = render(state);
    expect(panel.textContent).toContain(message);
  });

  it.each([
    [0, "0 ms"],
    [999, "999 ms"],
    [60_000, "1.0 minutes"],
    [3_600_000, "1.0 hours"],
    [86_400_000, "24.0 hours"],
  ])("formats bounded duration %i as %s", (durationMs, expected) => {
    const panel = render({
      kind: "success",
      snapshot: {
        schemaVersion: 1,
        order: "newest",
        events: [{ ...event, durationMs }],
      },
    });
    expect(panel.textContent).toContain(expected);
  });
});
