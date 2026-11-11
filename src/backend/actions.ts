import {
  SUPPORTED_AGENT_KINDS,
  isPaneId,
  isTabId,
  isWorkspaceId,
  type AgentKind,
} from "../shared/herdr.js";

/**
 * Every herdr command the UI may run, and nothing else. A request names one
 * of these and its params; the result is the exact argv, so no text from the
 * browser ever reaches a shell unquoted.
 */
export type HerdrAction =
  { kind: "cli"; args: string[] } | { kind: "focusPane"; paneId: string };

export class ActionError extends Error {}

const MAX_LABEL = 64;
const MAX_PATH = 512;
const MAX_TEXT = 8000;
// herdr's logical key names: enter, esc, ctrl+c, shift+tab, f5, a ...
const KEY_RE = /^[a-z0-9]+(?:\+[a-z0-9]+)*$|^[!-~]$/;
const MAX_KEYS = 32;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,128}$/;
const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const AGENT_KIND_SET = new Set<string>(SUPPORTED_AGENT_KINDS);

type Params = Record<string, unknown>;

function workspace(params: Params, key = "workspaceId"): string {
  const value = params[key];
  if (!isWorkspaceId(value)) throw new ActionError(`Invalid ${key}`);
  return value;
}

function tab(params: Params): string {
  if (!isTabId(params.tabId)) throw new ActionError("Invalid tabId");
  return params.tabId;
}

function pane(params: Params, key = "paneId"): string {
  const value = params[key];
  if (!isPaneId(value)) throw new ActionError(`Invalid ${key}`);
  return value;
}

function label(params: Params, required: boolean): string | null {
  const value = typeof params.label === "string" ? params.label.trim() : "";
  if (!value) {
    if (required) throw new ActionError("A label is required");
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (value.length > MAX_LABEL || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ActionError("Invalid label");
  }
  return value;
}

function cwdPath(params: Params, key = "cwd"): string | null {
  const value = typeof params[key] === "string" ? params[key].trim() : "";
  if (!value) return null;
  if (
    value.length > MAX_PATH ||
    value.startsWith("-") ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ActionError(`Invalid ${key}`);
  }
  return value;
}

function branch(params: Params): string {
  const value = typeof params.branch === "string" ? params.branch.trim() : "";
  if (
    !value ||
    !BRANCH_RE.test(value) ||
    value.startsWith("-") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("..")
  ) {
    throw new ActionError("Invalid branch");
  }
  return value;
}

function agentKind(params: Params): AgentKind {
  const value = typeof params.kind === "string" ? params.kind.trim() : "";
  if (!AGENT_KIND_SET.has(value)) {
    throw new ActionError("Invalid agent kind");
  }
  return value as AgentKind;
}

function agentName(params: Params, fallbackKind: string): string {
  const raw = typeof params.name === "string" ? params.name.trim() : "";
  if (!raw) return fallbackKind;
  if (!AGENT_NAME_RE.test(raw)) {
    throw new ActionError("Invalid agent name");
  }
  return raw;
}

function text(params: Params, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value) {
    throw new ActionError(`${key} is required`);
  }
  if (value.length > MAX_TEXT || value.includes("\u0000")) {
    throw new ActionError(`Invalid ${key}`);
  }
  return value;
}

function keys(params: Params): string[] {
  const value = params.keys;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_KEYS ||
    !value.every((key) => typeof key === "string" && KEY_RE.test(key))
  ) {
    throw new ActionError("Invalid keys");
  }
  return value as string[];
}

function direction(params: Params): "right" | "down" {
  if (params.direction === "right" || params.direction === "down") {
    return params.direction;
  }
  throw new ActionError("direction must be right or down");
}

function direction4(params: Params): "left" | "right" | "up" | "down" {
  if (
    params.direction === "left" ||
    params.direction === "right" ||
    params.direction === "up" ||
    params.direction === "down"
  ) {
    return params.direction;
  }
  throw new ActionError("direction must be left, right, up or down");
}

function resizeAmount(params: Params): string | null {
  if (params.amount === undefined || params.amount === null) return null;
  const num = Number(params.amount);
  if (!Number.isFinite(num) || num <= 0 || num > 1) {
    throw new ActionError("Invalid resize amount");
  }
  return String(num);
}

const builders: Record<string, (params: Params) => HerdrAction> = {
  "workspace.focus": (p) => cli("workspace", "focus", workspace(p)),
  "workspace.create": (p) => {
    const name = label(p, false);
    const cwd = cwdPath(p, "cwd");
    return cli(
      "workspace",
      "create",
      ...(cwd ? ["--cwd", cwd] : []),
      ...(name ? ["--label", name] : []),
      "--focus",
    );
  },
  "workspace.rename": (p) =>
    cli("workspace", "rename", workspace(p), label(p, true)!),
  "workspace.close": (p) =>
    cli(
      "workspace",
      "close",
      workspace(p),
      ...(p.group === true ? ["--group"] : []),
    ),
  "worktree.create": (p) => {
    const ws = workspace(p);
    const br = branch(p);
    const name = label(p, false);
    return cli(
      "worktree",
      "create",
      "--workspace",
      ws,
      "--branch",
      br,
      ...(name ? ["--label", name] : []),
      "--focus",
    );
  },
  "worktree.remove": (p) =>
    cli(
      "worktree",
      "remove",
      "--workspace",
      workspace(p),
      ...(p.force === true ? ["--force"] : []),
    ),
  "tab.focus": (p) => cli("tab", "focus", tab(p)),
  "tab.create": (p) => {
    const name = label(p, false);
    const cwd = cwdPath(p, "cwd");
    return cli(
      "tab",
      "create",
      "--workspace",
      workspace(p),
      ...(cwd ? ["--cwd", cwd] : []),
      ...(name ? ["--label", name] : []),
      "--focus",
    );
  },
  "tab.rename": (p) => cli("tab", "rename", tab(p), label(p, true)!),
  "tab.close": (p) => cli("tab", "close", tab(p)),
  "pane.focus": (p) => ({ kind: "focusPane", paneId: pane(p) }),
  "pane.rename": (p) => {
    const id = pane(p);
    if (p.clear === true) return cli("pane", "rename", id, "--clear");
    return cli("pane", "rename", id, label(p, true)!);
  },
  "pane.split": (p) =>
    cli("pane", "split", pane(p), "--direction", direction(p), "--focus"),
  "pane.resize": (p) => {
    const id = pane(p);
    const dir = direction4(p);
    const amount = resizeAmount(p);
    return cli(
      "pane",
      "resize",
      "--direction",
      dir,
      ...(amount ? ["--amount", amount] : []),
      "--pane",
      id,
    );
  },
  "pane.swap": (p) => {
    const id = pane(p);
    if (p.targetPaneId !== undefined) {
      return cli(
        "pane",
        "swap",
        "--source-pane",
        id,
        "--target-pane",
        pane(p, "targetPaneId"),
      );
    }
    return cli("pane", "swap", "--direction", direction4(p), "--pane", id);
  },
  "pane.zoom": (p) => cli("pane", "zoom", pane(p), "--toggle"),
  "pane.close": (p) => cli("pane", "close", pane(p)),
  "pane.sendText": (p) => cli("pane", "send-text", pane(p), text(p, "text")),
  "pane.sendKeys": (p) => cli("pane", "send-keys", pane(p), ...keys(p)),
  "pane.run": (p) => cli("pane", "run", pane(p), text(p, "command")),
  "pane.interrupt": (p) => cli("pane", "send-keys", pane(p), "ctrl+c"),
  "agent.prompt": (p) => cli("agent", "prompt", pane(p), text(p, "text")),
  "agent.pin": (p) => {
    const id = pane(p);
    if (typeof p.pinned !== "boolean") {
      throw new ActionError("pinned must be a boolean");
    }
    return cli(
      "pane",
      "label",
      id,
      p.pinned ? "herdr.pinned=true" : "herdr.pinned=",
    );
  },
  "agent.start": (p) => {
    const id = pane(p);
    const kind = agentKind(p);
    const name = agentName(p, kind);
    return cli("agent", "start", name, "--kind", kind, "--pane", id);
  },
};

function cli(...args: string[]): HerdrAction {
  return { kind: "cli", args };
}

export const ACTION_NAMES = Object.keys(builders);

/** Turns a request body into a herdr command, or throws ActionError. */
export function buildAction(name: unknown, params: unknown): HerdrAction {
  if (typeof name !== "string" || !Object.hasOwn(builders, name)) {
    throw new ActionError("Unknown action");
  }
  const safeParams =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Params)
      : {};
  return builders[name](safeParams);
}

/** How many output lines a pane read may ask for. */
export function readLines(value: unknown): number {
  const lines = Number(value ?? 80);
  if (!Number.isInteger(lines) || lines < 1) return 80;
  return Math.min(lines, 1000);
}
