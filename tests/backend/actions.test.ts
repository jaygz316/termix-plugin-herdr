import { describe, expect, it } from "vitest";
import {
  ActionError,
  buildAction,
  readLines,
} from "../../src/backend/actions.js";

describe("buildAction", () => {
  it("maps each action to herdr's CLI", () => {
    expect(buildAction("workspace.focus", { workspaceId: "w1Z" })).toEqual({
      kind: "cli",
      args: ["workspace", "focus", "w1Z"],
    });
    expect(
      buildAction("tab.create", { workspaceId: "w1", label: "logs" }),
    ).toEqual({
      kind: "cli",
      args: [
        "tab",
        "create",
        "--workspace",
        "w1",
        "--label",
        "logs",
        "--focus",
      ],
    });
    expect(
      buildAction("pane.split", { paneId: "w1:p2", direction: "down" }),
    ).toEqual({
      kind: "cli",
      args: ["pane", "split", "w1:p2", "--direction", "down", "--focus"],
    });
    expect(
      buildAction("agent.prompt", { paneId: "w1:p1", text: "go" }),
    ).toEqual({
      kind: "cli",
      args: ["agent", "prompt", "w1:p1", "go"],
    });
    expect(
      buildAction("pane.sendKeys", {
        paneId: "w1:p1",
        keys: ["ctrl+c", "enter"],
      }),
    ).toEqual({
      kind: "cli",
      args: ["pane", "send-keys", "w1:p1", "ctrl+c", "enter"],
    });
    expect(buildAction("pane.focus", { paneId: "w1:p3" })).toEqual({
      kind: "focusPane",
      paneId: "w1:p3",
    });
  });

  it("refuses unknown actions and bad ids", () => {
    const bad: Array<[unknown, unknown]> = [
      ["shell", {}],
      ["__proto__", {}],
      ["toString", {}],
      ["workspace.focus", { workspaceId: "w1; rm -rf /" }],
      ["workspace.focus", { workspaceId: "--help" }],
      ["tab.focus", { tabId: "w1:p1" }],
      ["pane.close", { paneId: "w1:t1" }],
      ["pane.split", { paneId: "w1:p1", direction: "left" }],
      ["pane.sendKeys", { paneId: "w1:p1", keys: ["$(id)"] }],
      ["pane.sendKeys", { paneId: "w1:p1", keys: [] }],
      ["pane.sendText", { paneId: "w1:p1", text: "" }],
      ["workspace.rename", { workspaceId: "w1", label: "a\nb" }],
      ["workspace.rename", { workspaceId: "w1", label: "x".repeat(65) }],
      ["agent.prompt", { paneId: "w1:p1", text: "x".repeat(8001) }],
    ];
    for (const [name, params] of bad) {
      expect(
        () => buildAction(name, params),
        JSON.stringify([name, params]),
      ).toThrow(ActionError);
    }
  });
});

describe("readLines", () => {
  it("defaults and clamps", () => {
    expect(readLines(undefined)).toBe(80);
    expect(readLines("20")).toBe(20);
    expect(readLines("0")).toBe(80);
    expect(readLines("5000")).toBe(1000);
    expect(readLines("abc")).toBe(80);
  });
});
