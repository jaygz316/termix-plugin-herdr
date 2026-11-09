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
    expect(
      buildAction("workspace.create", {
        label: "api-refactor",
        cwd: "~/projects/app",
      }),
    ).toEqual({
      kind: "cli",
      args: [
        "workspace",
        "create",
        "--cwd",
        "~/projects/app",
        "--label",
        "api-refactor",
        "--focus",
      ],
    });
    expect(
      buildAction("workspace.close", { workspaceId: "w1", group: true }),
    ).toEqual({
      kind: "cli",
      args: ["workspace", "close", "w1", "--group"],
    });
    expect(
      buildAction("worktree.create", {
        workspaceId: "w1",
        branch: "feat/auth",
        label: "auth",
      }),
    ).toEqual({
      kind: "cli",
      args: [
        "worktree",
        "create",
        "--workspace",
        "w1",
        "--branch",
        "feat/auth",
        "--label",
        "auth",
        "--focus",
      ],
    });
    expect(
      buildAction("worktree.remove", { workspaceId: "w2", force: true }),
    ).toEqual({
      kind: "cli",
      args: ["worktree", "remove", "--workspace", "w2", "--force"],
    });
    expect(
      buildAction("pane.rename", { paneId: "w1:p1", label: "server" }),
    ).toEqual({
      kind: "cli",
      args: ["pane", "rename", "w1:p1", "server"],
    });
    expect(
      buildAction("pane.rename", { paneId: "w1:p1", clear: true }),
    ).toEqual({
      kind: "cli",
      args: ["pane", "rename", "w1:p1", "--clear"],
    });
    expect(
      buildAction("pane.resize", {
        paneId: "w1:p1",
        direction: "right",
        amount: 0.1,
      }),
    ).toEqual({
      kind: "cli",
      args: [
        "pane",
        "resize",
        "--direction",
        "right",
        "--amount",
        "0.1",
        "--pane",
        "w1:p1",
      ],
    });
    expect(
      buildAction("pane.swap", { paneId: "w1:p1", targetPaneId: "w1:p2" }),
    ).toEqual({
      kind: "cli",
      args: [
        "pane",
        "swap",
        "--source-pane",
        "w1:p1",
        "--target-pane",
        "w1:p2",
      ],
    });
    expect(
      buildAction("agent.start", { paneId: "w1:p1", kind: "claude" }),
    ).toEqual({
      kind: "cli",
      args: ["agent", "start", "claude", "--kind", "claude", "--pane", "w1:p1"],
    });
  });

  it("refuses unknown actions and bad ids", () => {
    const bad: Array<[unknown, unknown]> = [
      ["shell", {}],
      ["__proto__", {}],
      ["toString", {}],
      ["workspace.focus", { workspaceId: "w1; rm -rf /" }],
      ["workspace.focus", { workspaceId: "--help" }],
      ["workspace.create", { cwd: "--help" }],
      ["workspace.create", { cwd: "a\nb" }],
      ["worktree.create", { branch: "--help" }],
      ["worktree.create", { branch: "feat..bad" }],
      ["worktree.create", { branch: "feat;rm" }],
      ["tab.focus", { tabId: "w1:p1" }],
      ["pane.close", { paneId: "w1:t1" }],
      ["pane.split", { paneId: "w1:p1", direction: "left" }],
      ["pane.resize", { paneId: "w1:p1", direction: "diagonal" }],
      ["pane.rename", { paneId: "w1:p1", label: "" }],
      ["pane.swap", { paneId: "w1:p1", targetPaneId: "bad" }],
      ["pane.sendKeys", { paneId: "w1:p1", keys: ["$(id)"] }],
      ["pane.sendKeys", { paneId: "w1:p1", keys: [] }],
      ["pane.sendText", { paneId: "w1:p1", text: "" }],
      ["workspace.rename", { workspaceId: "w1", label: "a\nb" }],
      ["workspace.rename", { workspaceId: "w1", label: "x".repeat(65) }],
      ["agent.prompt", { paneId: "w1:p1", text: "x".repeat(8001) }],
      ["agent.start", { paneId: "w1:p1", kind: "bash" }],
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
