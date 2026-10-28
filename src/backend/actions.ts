import { isPaneId, isTabId, isWorkspaceId } from "../shared/herdr.js";

/**
 * Every herdr command the UI may run, and nothing else. A request names one
 * of these and its params; the result is the exact argv, so no text from the
 * browser ever reaches a shell unquoted.
 */
export type HerdrAction =
  { kind: "cli"; args: string[] } | { kind: "focusPane"; paneId: string };

export class ActionError extends Error {}

const MAX_LABEL = 64;
const MAX_TEXT = 8000;
// herdr's logical key names: enter, esc, ctrl+c, shift+tab, f5, a ...
const KEY_RE = /^[a-z0-9]+(?:\+[a-z0-9]+)*$|^[!-~]$/;
const MAX_KEYS = 32;

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

function pane(params: Params): string {
  if (!isPaneId(params.paneId)) throw new ActionError("Invalid paneId");
  return params.paneId;
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

const builders: Record<string, (params: Params) => HerdrAction> = {
  "workspace.focus": (p) => cli("workspace", "focus", workspace(p)),
  "workspace.create": (p) => {
    const name = label(p, false);
    return cli(
      "workspace",
      "create",
      ...(name ? ["--label", name] : []),
      "--focus",
    );
  },
  "workspace.rename": (p) =>
    cli("workspace", "rename", workspace(p), label(p, true)!),
  "workspace.close": (p) => cli("workspace", "close", workspace(p)),
  "tab.focus": (p) => cli("tab", "focus", tab(p)),
  "tab.create": (p) => {
    const name = label(p, false);
    return cli(
      "tab",
      "create",
      "--workspace",
      workspace(p),
      ...(name ? ["--label", name] : []),
      "--focus",
    );
  },
  "tab.rename": (p) => cli("tab", "rename", tab(p), label(p, true)!),
  "tab.close": (p) => cli("tab", "close", tab(p)),
  "pane.focus": (p) => ({ kind: "focusPane", paneId: pane(p) }),
  "pane.split": (p) =>
    cli("pane", "split", pane(p), "--direction", direction(p), "--focus"),
  "pane.zoom": (p) => cli("pane", "zoom", pane(p), "--toggle"),
  "pane.close": (p) => cli("pane", "close", pane(p)),
  "pane.sendText": (p) => cli("pane", "send-text", pane(p), text(p, "text")),
  "pane.sendKeys": (p) => cli("pane", "send-keys", pane(p), ...keys(p)),
  "pane.run": (p) => cli("pane", "run", pane(p), text(p, "command")),
  "agent.prompt": (p) => cli("agent", "prompt", pane(p), text(p, "text")),
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
