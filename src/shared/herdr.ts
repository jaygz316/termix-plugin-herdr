// Shared between the backend and the frontend: what a herdr id looks like,
// the host settings that say how to reach herdr, and the snapshot shape.

export const PLUGIN_ID = "herdr";

/** Host setting keys, as declared in manifest.json. */
export const HOST_SETTINGS = {
  enabled: "enableHerdr",
  binary: "binaryPath",
  session: "sessionName",
} as const;

export const DEFAULT_BINARY = "herdr";

// herdr ids are opaque but always look like w1, w1:t1 and w1:p1, with the
// workspace part being letters and digits (w1Z, w14).
const WORKSPACE_RE = /^w[0-9A-Za-z]{1,16}$/;
const TAB_RE = /^w[0-9A-Za-z]{1,16}:t[0-9A-Za-z]{1,16}$/;
const PANE_RE = /^w[0-9A-Za-z]{1,16}:p[0-9A-Za-z]{1,16}$/;
// Typed into a shell and passed to sh unquoted, so keep it to characters no
// shell treats specially. A leading ~/ is expanded by the caller.
const BINARY_RE = /^~?[A-Za-z0-9_./+-]{1,255}$/;
const SESSION_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export const isWorkspaceId = (value: unknown): value is string =>
  typeof value === "string" && WORKSPACE_RE.test(value);
export const isTabId = (value: unknown): value is string =>
  typeof value === "string" && TAB_RE.test(value);
export const isPaneId = (value: unknown): value is string =>
  typeof value === "string" && PANE_RE.test(value);

/** The herdr binary to run, or null when the setting is unusable. */
export function normalizeBinary(value: unknown): string | null {
  const binary =
    typeof value === "string" && value.trim() ? value.trim() : DEFAULT_BINARY;
  if (!BINARY_RE.test(binary) || binary.includes("..")) return null;
  if (binary.startsWith("~") && !binary.startsWith("~/")) return null;
  return binary;
}

/** The named session to use, "" for herdr's default, null when invalid. */
export function normalizeSession(value: unknown): string | null {
  const session = typeof value === "string" ? value.trim() : "";
  if (!session || session === "default") return "";
  return SESSION_RE.test(session) ? session : null;
}

/**
 * The command typed into the host's interactive shell to start or attach the
 * herdr client. Both parts are validated to contain nothing a shell expands,
 * so it is the same in bash, zsh and fish.
 */
export function launchCommand(binary: string, session: string): string {
  return session ? `${binary} --session ${session}` : binary;
}

export const SUPPORTED_AGENT_KINDS = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "copilot",
  "cursor",
  "pi",
  "amp",
  "droid",
  "devin",
  "kimi",
  "kilo",
  "qwen",
  "grok",
  "agy",
  "cline",
  "omp",
  "mastracode",
  "kiro",
  "hermes",
  "qodercli",
  "letta",
  "maki",
  "muse",
] as const;

export type AgentKind = (typeof SUPPORTED_AGENT_KINDS)[number];

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface HerdrRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HerdrWorkspace {
  workspace_id: string;
  label: string;
  number: number;
  focused: boolean;
  active_tab_id: string;
  agent_status: AgentStatus;
  pane_count: number;
  tab_count: number;
  worktree?: {
    branch?: string;
    path?: string;
    primary_workspace_id?: string;
  } | null;
}

export interface HerdrTab {
  tab_id: string;
  workspace_id: string;
  label: string;
  number: number;
  focused: boolean;
  agent_status: AgentStatus;
  pane_count: number;
}

export interface HerdrPane {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  focused: boolean;
  agent?: string;
  agent_status: AgentStatus;
  cwd?: string;
  foreground_cwd?: string;
  label?: string;
  terminal_title_stripped?: string;
}

export interface HerdrLayout {
  tab_id: string;
  workspace_id: string;
  area: HerdrRect;
  focused_pane_id: string;
  zoomed: boolean;
  panes: { pane_id: string; focused: boolean; rect: HerdrRect }[];
}

export interface HerdrSnapshot {
  version: string;
  protocol: number;
  focused_workspace_id: string | null;
  focused_tab_id: string | null;
  focused_pane_id: string | null;
  workspaces: HerdrWorkspace[];
  tabs: HerdrTab[];
  panes: HerdrPane[];
  layouts: HerdrLayout[];
  agents: HerdrPane[];
}

export interface HerdrSessionInfo {
  name: string;
  running?: boolean;
  attached?: number;
}

/** Why herdr could not be reached, for the UI to explain. */
export type HerdrErrorCode =
  | "HERDR_NOT_INSTALLED"
  | "HERDR_NOT_RUNNING"
  | "HOST_UNREACHABLE"
  | "HERDR_ERROR";

export type HerdrState =
  | { available: true; snapshot: HerdrSnapshot }
  | { available: false; code: HerdrErrorCode; error: string };
