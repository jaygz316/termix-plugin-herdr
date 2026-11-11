// Shared between the backend and the frontend: what a herdr id looks like,
// the host settings that say how to reach herdr, and the snapshot shape.

export const PLUGIN_ID = "herdr";

/** Host setting keys, as declared in manifest.json. */
export const HOST_SETTINGS = {
  enabled: "enableHerdr",
  runtimeMode: "runtimeMode",
  binary: "binaryPath",
  session: "sessionName",
} as const;

export const DEFAULT_BINARY = "herdr";

export type HerdrRuntime = "hc" | "legacy";
export type HerdrRuntimeMode = "auto" | "hc" | "legacy";

export function normalizeRuntimeMode(value: unknown): HerdrRuntimeMode {
  if (value === "hc" || value === "legacy") return value;
  return "auto";
}

// Legacy herdr ids look like w1, w1:t1 and w1:p1; new herdr-core (hc) /
// herdr-app ids look like sp<hex>, tb<hex>, p<hex>, t<base36> (or a terminal
// name), with an optional `<machine>/` prefix for linked remote machines.
const MACHINE_PREFIX = "(?:[A-Za-z0-9_.-]{1,32}/)?";
const WORKSPACE_RE = new RegExp(
  `^${MACHINE_PREFIX}(?:w[0-9A-Za-z]{1,16}|sp[0-9a-f]{8,64}|space-[0-9A-Za-z_-]{1,32})$`,
);
const TAB_RE = new RegExp(
  `^${MACHINE_PREFIX}(?:w[0-9A-Za-z]{1,16}:t[0-9A-Za-z]{1,16}|tb[0-9a-f]{8,64}|tab-[0-9A-Za-z_-]{1,32})$`,
);
const PANE_RE = new RegExp(
  `^${MACHINE_PREFIX}(?:w[0-9A-Za-z]{1,16}:p[0-9A-Za-z]{1,16}|p[0-9a-f]{8,64}|pane-[0-9A-Za-z_-]{1,32}|t[0-9a-z]{1,16})$`,
);
const TERMINAL_RE = new RegExp(
  `^${MACHINE_PREFIX}(?:t[0-9a-z]{1,16}|[a-z0-9][a-z0-9_-]{0,31})$`,
);
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
export const isTerminalId = (value: unknown): value is string =>
  typeof value === "string" && TERMINAL_RE.test(value);

/** Whether a configured binary path points straight to herdr-core (hc). */
export function isHcBinaryName(binary: string): boolean {
  const base = binary.split("/").pop() ?? binary;
  return base === "hc" || base === "herdr-core";
}

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

export interface LaunchOptions {
  runtime?: HerdrRuntime;
  terminalId?: string | null;
}

/**
 * The command typed into the host's interactive shell to start or attach the
 * herdr client. All parts are validated to contain nothing a shell expands,
 * so it is the same in bash, zsh and fish.
 */
export function launchCommand(
  binary: string,
  session: string,
  options?: LaunchOptions,
): string {
  const runtime =
    options?.runtime ?? (isHcBinaryName(binary) ? "hc" : undefined);
  const terminalId =
    options?.terminalId && isTerminalId(options.terminalId)
      ? options.terminalId
      : null;

  if (runtime === "hc") {
    const hcCmd = isHcBinaryName(binary) ? binary : "hc";
    const envPrefix = session ? `env HC_SESSION=${session} ` : "";
    return terminalId
      ? `${envPrefix}${hcCmd} attach ${terminalId}`
      : `${envPrefix}${hcCmd}`;
  }
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

export type AgentStatus =
  "idle" | "working" | "blocked" | "done" | "error" | "unknown";

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
  machine?: string | null;
  folder?: string;
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
  /** herdr-core (hc) terminal address, e.g. "t18" or "ucloud/t4". */
  terminal_id?: string;
  /** Rich status message reported by the agent via OSC 7501. */
  status_msg?: string | null;
  /** Pinned in the Herdr agents list (`herdr.pinned` label). */
  pinned?: boolean;
  /** Parent terminal address when this agent is a sub-agent. */
  parent_id?: string | null;
  /** Machine name when the terminal runs on a linked remote machine. */
  machine?: string | null;
  /** Current agent turn counter. */
  turn?: number;
  /** True when the agent finished or blocked since the user last looked. */
  unseen?: boolean;
}

export interface HerdrLayout {
  tab_id: string;
  workspace_id: string;
  area: HerdrRect;
  focused_pane_id: string;
  zoomed: boolean;
  panes: { pane_id: string; focused: boolean; rect: HerdrRect }[];
}

export interface HerdrMachineInfo {
  name: string;
  target?: string;
  state?: string;
  version?: string | null;
  why?: string | null;
}

export interface HerdrSnapshot {
  version: string;
  protocol: number;
  runtime?: HerdrRuntime;
  focused_workspace_id: string | null;
  focused_tab_id: string | null;
  focused_pane_id: string | null;
  focused_terminal_id?: string | null;
  workspaces: HerdrWorkspace[];
  tabs: HerdrTab[];
  panes: HerdrPane[];
  layouts: HerdrLayout[];
  agents: HerdrPane[];
  machines?: HerdrMachineInfo[];
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
