import {
  DEFAULT_BINARY,
  SUPPORTED_AGENT_KINDS,
  isHcBinaryName,
  type AgentStatus,
  type HerdrLayout,
  type HerdrMachineInfo,
  type HerdrPane,
  type HerdrRect,
  type HerdrSnapshot,
  type HerdrTab,
  type HerdrWorkspace,
} from "../shared/herdr.js";
import {
  NOT_FOUND_MARK,
  PREAMBLE,
  hcScriptHead,
  parseHerdrResult,
  shQuote,
  type ScriptResult,
} from "./remote.js";

export const HC_STATE_MARKER = "__TERMIX_HC_STATE__";
export const HC_VIEW_MARKER = "__TERMIX_HC_VIEW__";

export interface HcTerminal {
  address: string;
  argv?: string[];
  cols?: number;
  rows?: number;
  cwd?: string;
  foreground?: {
    argv?: string[];
    cwd?: string;
    name?: string;
    pid?: number;
  } | null;
  keep?: boolean;
  labels?: Record<string, string>;
  name?: string | null;
  parent?: string | null;
  pid?: number | null;
  reported?: boolean;
  state?: string;
  status?: {
    app?: string;
    msg?: string;
    state?: string;
  } | null;
  title?: string;
  turn?: number;
}

export interface HcMachine {
  id?: string;
  name: string;
  host?: string;
  target?: string;
  state?: string;
  temporary?: boolean;
  version?: string | null;
  why?: string | null;
}

export interface HcDocLayoutNode {
  id?: string;
  type?: "row" | "column" | "block" | "split" | "pane";
  size?: { weight?: number };
  content?: { terminal?: string };
  terminalId?: string;
  label?: string;
  direction?: "right" | "down";
  ratio?: number;
  children?: HcDocLayoutNode[];
  first?: HcDocLayoutNode;
  second?: HcDocLayoutNode;
}

export interface HcDocTab {
  id: string;
  name?: string;
  root?: HcDocLayoutNode;
}

export interface HcDocSpace {
  id: string;
  name?: string;
  folder?: string;
  tabs?: HcDocTab[];
}

export interface HcDocValue {
  spaces?: HcDocSpace[];
}

export interface HcViewFile {
  active?: string | null;
  spaces?: Record<string, string>;
  tabs?: Record<
    string,
    {
      focused?: string | null;
      zoomed?: string | null;
      settled?: number | null;
    }
  >;
}

const AGENT_KIND_SET = new Set<string>(SUPPORTED_AGENT_KINDS);

const STATUS_PRIORITY: Record<AgentStatus, number> = {
  blocked: 6,
  error: 5,
  working: 4,
  done: 3,
  idle: 2,
  unknown: 1,
};

function pickHigherStatus(a: AgentStatus, b: AgentStatus): AgentStatus {
  return STATUS_PRIORITY[b] > STATUS_PRIORITY[a] ? b : a;
}

function aggregateStatus(statuses: AgentStatus[]): AgentStatus {
  let best: AgentStatus = "unknown";
  for (const s of statuses) {
    best = pickHigherStatus(best, s);
  }
  return best;
}

function basename(path: string | undefined | null): string {
  if (!path) return "";
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) return "/";
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function splitMachineAddress(address: string): {
  machine: string | null;
  localId: string;
} {
  const slash = address.indexOf("/");
  if (slash <= 0) return { machine: null, localId: address };
  return {
    machine: address.slice(0, slash),
    localId: address.slice(slash + 1),
  };
}

function detectAgentName(term: HcTerminal): string | undefined {
  const app = term.status?.app?.trim();
  if (app) {
    const normalized = app.toLowerCase().replace(/-code$|-cli$/, "");
    if (AGENT_KIND_SET.has(normalized)) return normalized;
    return app;
  }
  const fgName = term.foreground?.name?.trim().toLowerCase() ?? "";
  if (AGENT_KIND_SET.has(fgName)) return fgName;

  for (const arg of term.foreground?.argv ?? []) {
    const base = basename(arg)
      .toLowerCase()
      .replace(/-code$|-cli$/, "");
    if (AGENT_KIND_SET.has(base)) return base;
  }

  const pinned =
    term.labels?.["herdr.pinned"] &&
    term.labels["herdr.pinned"] !== "false" &&
    term.labels["herdr.pinned"] !== "0";
  if (term.reported || term.status || pinned) {
    if (
      fgName &&
      fgName !== "bash" &&
      fgName !== "zsh" &&
      fgName !== "fish" &&
      fgName !== "sh"
    ) {
      return fgName;
    }
    return "agent";
  }
  return undefined;
}

function classifyTerminal(term: HcTerminal | undefined): {
  agent?: string;
  agent_status: AgentStatus;
  status_msg?: string | null;
  pinned?: boolean;
  unseen?: boolean;
} {
  if (!term) return { agent_status: "unknown" };
  const agent = detectAgentName(term);
  const rawState = term.status?.state;
  let agent_status: AgentStatus = "unknown";
  if (
    rawState === "idle" ||
    rawState === "working" ||
    rawState === "blocked" ||
    rawState === "done" ||
    rawState === "error"
  ) {
    agent_status = rawState;
  } else if (agent) {
    agent_status = "idle";
  }

  const pinned = Boolean(
    term.labels?.["herdr.pinned"] &&
    term.labels["herdr.pinned"] !== "false" &&
    term.labels["herdr.pinned"] !== "0",
  );
  const seenTurn = Number(term.labels?.["herdr.seen"] ?? 0);
  const turn = typeof term.turn === "number" ? term.turn : 0;
  const unseen =
    (agent_status === "done" ||
      agent_status === "blocked" ||
      agent_status === "error") &&
    turn > seenTurn;

  return {
    ...(agent ? { agent } : {}),
    agent_status,
    ...(term.status?.msg ? { status_msg: term.status.msg } : {}),
    ...(pinned ? { pinned: true } : {}),
    ...(unseen ? { unseen: true } : {}),
  };
}

interface LeafSpec {
  paneId: string;
  terminalId?: string;
  label?: string;
  rect: HerdrRect;
}

function walkLayoutNode(
  node: HcDocLayoutNode | undefined,
  rect: HerdrRect,
  fallbackId: string,
): LeafSpec[] {
  if (!node) {
    return [{ paneId: fallbackId, rect }];
  }
  if (
    (node.type === "row" || node.type === "column") &&
    Array.isArray(node.children) &&
    node.children.length > 0
  ) {
    const children = node.children.filter(Boolean);
    const weights = children.map((child) =>
      Math.max(0.05, Number(child.size?.weight ?? 1) || 1),
    );
    const total = weights.reduce((acc, w) => acc + w, 0);
    const out: LeafSpec[] = [];
    let offset = 0;
    for (let i = 0; i < children.length; i++) {
      const isLast = i === children.length - 1;
      const ratio = weights[i] / total;
      if (node.type === "row") {
        const width = isLast
          ? Math.max(1, rect.width - offset)
          : Math.max(1, Math.round(rect.width * ratio));
        out.push(
          ...walkLayoutNode(
            children[i],
            { x: rect.x + offset, y: rect.y, width, height: rect.height },
            `${fallbackId}:${i}`,
          ),
        );
        offset += width;
      } else {
        const height = isLast
          ? Math.max(1, rect.height - offset)
          : Math.max(1, Math.round(rect.height * ratio));
        out.push(
          ...walkLayoutNode(
            children[i],
            { x: rect.x, y: rect.y + offset, width: rect.width, height },
            `${fallbackId}:${i}`,
          ),
        );
        offset += height;
      }
    }
    return out;
  }

  if (node.type === "split" && node.first && node.second) {
    const ratio = Math.max(0.1, Math.min(0.9, Number(node.ratio ?? 0.5)));
    if (node.direction !== "down") {
      const firstW = Math.max(1, Math.round(rect.width * ratio));
      const secondW = Math.max(1, rect.width - firstW);
      return [
        ...walkLayoutNode(
          node.first,
          { x: rect.x, y: rect.y, width: firstW, height: rect.height },
          `${fallbackId}:0`,
        ),
        ...walkLayoutNode(
          node.second,
          {
            x: rect.x + firstW,
            y: rect.y,
            width: secondW,
            height: rect.height,
          },
          `${fallbackId}:1`,
        ),
      ];
    }
    const firstH = Math.max(1, Math.round(rect.height * ratio));
    const secondH = Math.max(1, rect.height - firstH);
    return [
      ...walkLayoutNode(
        node.first,
        { x: rect.x, y: rect.y, width: rect.width, height: firstH },
        `${fallbackId}:0`,
      ),
      ...walkLayoutNode(
        node.second,
        {
          x: rect.x,
          y: rect.y + firstH,
          width: rect.width,
          height: secondH,
        },
        `${fallbackId}:1`,
      ),
    ];
  }

  const terminalId = node.content?.terminal ?? node.terminalId;
  const paneId = node.id || terminalId || fallbackId;
  return [
    {
      paneId,
      ...(terminalId ? { terminalId } : {}),
      ...(node.label ? { label: node.label } : {}),
      rect,
    },
  ];
}

function hcCollectCommands(binVar: string, session: string): string[] {
  const rpcLines = [
    '{"jsonrpc":"2.0","id":1,"method":"server.status","params":{}}',
    '{"jsonrpc":"2.0","id":2,"method":"terminal.list","params":{"all":false}}',
    '{"jsonrpc":"2.0","id":3,"method":"doc.get","params":{"name":"herdr-app"}}',
  ].map(shQuote);

  return [
    ...(session
      ? [`HC_SESSION=${shQuote(session)}`, "export HC_SESSION"]
      : ["unset HC_SESSION"]),
    `printf '%s\\n' ${shQuote(HC_STATE_MARKER)}`,
    `printf '%s\\n' ${rpcLines.join(" ")} | "${binVar}" connect`,
    "rc=$?",
    'if [ "$rc" -ne 0 ]; then exit "$rc"; fi',
    `printf '\\n%s\\n' ${shQuote(HC_VIEW_MARKER)}`,
    'if [ -f "$HOME/.config/herdr-app/view.json" ]; then cat "$HOME/.config/herdr-app/view.json"; fi',
  ];
}

/**
 * Builds the `sh -s` script for `GET /hosts/:hostId/state`.
 *
 * When the host binary is the default `herdr`, this prefers `hc` (`herdr-core`)
 * whenever `hc` is installed and no legacy `herdr` daemon is running, while
 * keeping the exact `exec "$H" ... 'api' 'snapshot'` tail for legacy hosts.
 */
export function buildStateScript(binary: string, session: string): string {
  if (isHcBinaryName(binary)) {
    return [
      ...hcScriptHead(binary, session),
      ...hcCollectCommands("$H", session),
      "",
    ].join("\n");
  }

  const assign = binary.startsWith("~/")
    ? `H="$HOME"/${shQuote(binary.slice(2))}`
    : `H=${shQuote(binary)}`;
  const prefix = session ? `"$H" --session ${shQuote(session)}` : `"$H"`;

  const autoDetectHc =
    binary === DEFAULT_BINARY
      ? [
          'if command -v hc >/dev/null 2>&1; then HC_BIN=hc; elif command -v herdr-core >/dev/null 2>&1; then HC_BIN=herdr-core; else HC_BIN=""; fi',
          `if [ -n "$HC_BIN" ] && ! ${prefix} status server >/dev/null 2>&1; then`,
          ...hcCollectCommands("$HC_BIN", session).map((line) => `  ${line}`),
          "  exit 0",
          "fi",
        ]
      : [];

  return [
    ...PREAMBLE,
    assign,
    ...autoDetectHc,
    `command -v "$H" >/dev/null 2>&1 || { echo ${NOT_FOUND_MARK} >&2; exit 127; }`,
    `exec ${prefix} 'api' 'snapshot'`,
    "",
  ].join("\n");
}

function makePaneFromTerminal(
  paneId: string,
  tabId: string,
  workspaceId: string,
  focused: boolean,
  term: HcTerminal | undefined,
  explicitLabel?: string,
): HerdrPane {
  const classified = classifyTerminal(term);
  const { machine } = term
    ? splitMachineAddress(term.address)
    : splitMachineAddress(paneId);
  const label = explicitLabel || term?.name || undefined;
  return {
    pane_id: paneId,
    tab_id: tabId,
    workspace_id: workspaceId,
    focused,
    ...(classified.agent ? { agent: classified.agent } : {}),
    agent_status: classified.agent_status,
    ...(term?.cwd ? { cwd: term.cwd } : {}),
    ...(term?.foreground?.cwd ? { foreground_cwd: term.foreground.cwd } : {}),
    ...(label ? { label } : {}),
    ...(term?.title ? { terminal_title_stripped: term.title } : {}),
    ...(term?.address ? { terminal_id: term.address } : {}),
    ...(classified.status_msg ? { status_msg: classified.status_msg } : {}),
    ...(classified.pinned ? { pinned: true } : {}),
    ...(term?.parent ? { parent_id: term.parent } : {}),
    ...(machine ? { machine } : {}),
    ...(typeof term?.turn === "number" ? { turn: term.turn } : {}),
    ...(classified.unseen ? { unseen: true } : {}),
  };
}

function deriveSpaceLabel(
  space: HcDocSpace,
  spaceTabs: HerdrTab[],
  spacePanes: HerdrPane[],
): string {
  const explicit = space.name?.trim();
  if (explicit) return explicit;
  for (const p of spacePanes) {
    const fgBase = basename(p.foreground_cwd);
    if (fgBase && p.foreground_cwd !== space.folder) return fgBase;
  }
  const firstTab = spaceTabs[0]?.label?.trim();
  if (firstTab && !/^\d+$/.test(firstTab)) return firstTab;
  return basename(space.folder) || "space";
}

/**
 * Synthesizes a `HerdrSnapshot` from `hc connect` JSON-RPC replies and
 * `~/.config/herdr-app/view.json`.
 */
export function synthesizeHcSnapshot(
  serverStatus: { version?: string; core?: { name?: string } } | undefined,
  terminalList:
    { terminals?: HcTerminal[]; machines?: HcMachine[] } | undefined,
  docValue: HcDocValue | null | undefined,
  view: HcViewFile | null | undefined,
): HerdrSnapshot {
  const version = serverStatus?.version ?? "0.1.0";
  const allTerminals = Array.isArray(terminalList?.terminals)
    ? terminalList.terminals
    : [];
  const liveTerminals = allTerminals.filter((t) => t.state === "live");
  const terminalByAddress = new Map<string, HcTerminal>();
  for (const t of liveTerminals) {
    terminalByAddress.set(t.address, t);
  }

  const assignedTerminals = new Set<string>();
  const workspaces: HerdrWorkspace[] = [];
  const tabs: HerdrTab[] = [];
  const panes: HerdrPane[] = [];
  const layouts: HerdrLayout[] = [];

  const docSpaces = Array.isArray(docValue?.spaces) ? docValue.spaces : [];

  for (const space of docSpaces) {
    if (!space?.id) continue;
    const wsId = space.id;
    const rawTabs = Array.isArray(space.tabs) ? space.tabs : [];
    const wsTabs: HerdrTab[] = [];
    const wsPanes: HerdrPane[] = [];

    for (let tIdx = 0; tIdx < rawTabs.length; tIdx++) {
      const rawTab = rawTabs[tIdx];
      if (!rawTab?.id) continue;
      const tabId = rawTab.id;
      const area: HerdrRect = { x: 0, y: 0, width: 100, height: 40 };
      const leaves = walkLayoutNode(rawTab.root, area, `${tabId}:p0`);
      const tabView = view?.tabs?.[tabId];
      const desiredFocus = tabView?.focused ?? null;
      const focusedLeafId =
        leaves.find((l) => l.paneId === desiredFocus)?.paneId ??
        leaves[0]?.paneId ??
        "";

      const tabPanes: HerdrPane[] = [];
      for (const leaf of leaves) {
        const term = leaf.terminalId
          ? terminalByAddress.get(leaf.terminalId)
          : undefined;
        if (leaf.terminalId) assignedTerminals.add(leaf.terminalId);
        const pane = makePaneFromTerminal(
          leaf.paneId,
          tabId,
          wsId,
          leaf.paneId === focusedLeafId,
          term,
          leaf.label,
        );
        tabPanes.push(pane);
        panes.push(pane);
        wsPanes.push(pane);
      }

      layouts.push({
        tab_id: tabId,
        workspace_id: wsId,
        area,
        focused_pane_id: focusedLeafId,
        zoomed: Boolean(tabView?.zoomed),
        panes: leaves.map((leaf) => ({
          pane_id: leaf.paneId,
          focused: leaf.paneId === focusedLeafId,
          rect: leaf.rect,
        })),
      });

      const tabObj: HerdrTab = {
        tab_id: tabId,
        workspace_id: wsId,
        label: rawTab.name?.trim() || String(tIdx + 1),
        number: tIdx + 1,
        focused: false,
        agent_status: aggregateStatus(tabPanes.map((p) => p.agent_status)),
        pane_count: tabPanes.length,
      };
      tabs.push(tabObj);
      wsTabs.push(tabObj);
    }

    const desiredTabId = view?.spaces?.[wsId];
    const activeTabId =
      wsTabs.find((t) => t.tab_id === desiredTabId)?.tab_id ??
      wsTabs[0]?.tab_id ??
      "";
    for (const t of wsTabs) {
      t.focused = t.tab_id === activeTabId;
    }

    workspaces.push({
      workspace_id: wsId,
      label: deriveSpaceLabel(space, wsTabs, wsPanes),
      number: workspaces.length + 1,
      focused: false,
      active_tab_id: activeTabId,
      agent_status: aggregateStatus(wsPanes.map((p) => p.agent_status)),
      pane_count: wsPanes.length,
      tab_count: wsTabs.length,
      machine: null,
      ...(space.folder ? { folder: space.folder } : {}),
    });
  }

  // Group remaining live top-level terminals (including remote machines like
  // ucloud/t4 that carry herdr.space / herdr.tab labels, or standalone shells).
  const remoteSpaces = new Map<
    string,
    {
      wsId: string;
      machine: string | null;
      label: string;
      folder?: string;
      tabs: Map<string, { tabId: string; label: string; terms: HcTerminal[] }>;
    }
  >();

  for (const term of liveTerminals) {
    if (assignedTerminals.has(term.address)) continue;
    if (term.parent) continue;
    const fgName = term.foreground?.name;
    const hasSpaceLabel = Boolean(term.labels?.["herdr.space"]);
    if (
      !hasSpaceLabel &&
      term.keep === false &&
      (fgName === "hc" || fgName === "herdr-core" || fgName === "herdr")
    ) {
      continue;
    }

    const { machine, localId } = splitMachineAddress(term.address);
    const rawSpaceId = term.labels?.["herdr.space"];
    const rawTabId = term.labels?.["herdr.tab"];
    const whereParts = (term.labels?.where ?? "").split(" / ");
    const whereSpace = whereParts[0]?.trim();
    const whereTab = whereParts.slice(1).join(" / ").trim();

    const wsId = rawSpaceId
      ? machine && !rawSpaceId.startsWith(`${machine}/`)
        ? `${machine}/${rawSpaceId}`
        : rawSpaceId
      : machine
        ? `${machine}/space-terminals`
        : "space-terminals";

    const tabId = rawTabId
      ? machine && !rawTabId.startsWith(`${machine}/`)
        ? `${machine}/${rawTabId}`
        : rawTabId
      : machine
        ? `${machine}/tab-${localId}`
        : `tab-${localId}`;

    let group = remoteSpaces.get(wsId);
    if (!group) {
      const baseLabel =
        whereSpace ||
        basename(term.foreground?.cwd || term.cwd) ||
        (rawSpaceId ? "space" : "terminals");
      group = {
        wsId,
        machine,
        label: machine ? `${machine}: ${baseLabel}` : baseLabel,
        folder: term.cwd,
        tabs: new Map(),
      };
      remoteSpaces.set(wsId, group);
    }

    let tabGroup = group.tabs.get(tabId);
    if (!tabGroup) {
      tabGroup = {
        tabId,
        label:
          whereTab || term.name || term.title || String(group.tabs.size + 1),
        terms: [],
      };
      group.tabs.set(tabId, tabGroup);
    }
    tabGroup.terms.push(term);
    assignedTerminals.add(term.address);
  }

  for (const group of remoteSpaces.values()) {
    const wsTabs: HerdrTab[] = [];
    const wsPanes: HerdrPane[] = [];
    let tIdx = 0;
    for (const tabGroup of group.tabs.values()) {
      tIdx += 1;
      const area: HerdrRect = { x: 0, y: 0, width: 100, height: 40 };
      const count = Math.max(1, tabGroup.terms.length);
      const tabPanes: HerdrPane[] = [];
      const layoutPanes: HerdrLayout["panes"] = [];

      for (let i = 0; i < tabGroup.terms.length; i++) {
        const term = tabGroup.terms[i];
        const x = Math.round((100 * i) / count);
        const nextX =
          i === count - 1 ? 100 : Math.round((100 * (i + 1)) / count);
        const rect: HerdrRect = {
          x,
          y: 0,
          width: Math.max(1, nextX - x),
          height: 40,
        };
        const focused = i === 0;
        const pane = makePaneFromTerminal(
          term.address,
          tabGroup.tabId,
          group.wsId,
          focused,
          term,
        );
        tabPanes.push(pane);
        panes.push(pane);
        wsPanes.push(pane);
        layoutPanes.push({
          pane_id: pane.pane_id,
          focused,
          rect,
        });
      }

      const focusedPaneId = tabPanes[0]?.pane_id ?? "";
      layouts.push({
        tab_id: tabGroup.tabId,
        workspace_id: group.wsId,
        area,
        focused_pane_id: focusedPaneId,
        zoomed: false,
        panes: layoutPanes,
      });

      const tabObj: HerdrTab = {
        tab_id: tabGroup.tabId,
        workspace_id: group.wsId,
        label: tabGroup.label,
        number: tIdx,
        focused: tIdx === 1,
        agent_status: aggregateStatus(tabPanes.map((p) => p.agent_status)),
        pane_count: tabPanes.length,
      };
      tabs.push(tabObj);
      wsTabs.push(tabObj);
    }

    const activeTabId = wsTabs[0]?.tab_id ?? "";
    workspaces.push({
      workspace_id: group.wsId,
      label: group.label,
      number: workspaces.length + 1,
      focused: false,
      active_tab_id: activeTabId,
      agent_status: aggregateStatus(wsPanes.map((p) => p.agent_status)),
      pane_count: wsPanes.length,
      tab_count: wsTabs.length,
      machine: group.machine,
      ...(group.folder ? { folder: group.folder } : {}),
    });
  }

  const desiredWsId = view?.active ?? null;
  const focusedWs =
    workspaces.find((w) => w.workspace_id === desiredWsId) ??
    workspaces[0] ??
    null;
  for (const w of workspaces) {
    w.focused = focusedWs ? w.workspace_id === focusedWs.workspace_id : false;
  }

  const focusedTabId = focusedWs?.active_tab_id || tabs[0]?.tab_id || null;
  const focusedLayout = layouts.find((l) => l.tab_id === focusedTabId);
  const focusedPaneId =
    focusedLayout?.focused_pane_id || panes[0]?.pane_id || null;
  const focusedPane =
    panes.find((p) => p.pane_id === focusedPaneId) ?? panes[0] ?? null;
  const focusedTerminalId =
    focusedPane?.terminal_id ?? liveTerminals[0]?.address ?? null;

  const agents: HerdrPane[] = panes.filter((p) => Boolean(p.agent));

  // Include live sub-agent terminals that don't have their own pane block.
  for (const term of liveTerminals) {
    if (assignedTerminals.has(term.address) || !term.parent) continue;
    const parentPane = panes.find((p) => p.terminal_id === term.parent);
    const subPane = makePaneFromTerminal(
      term.address,
      parentPane?.tab_id ?? focusedTabId ?? "tab-sub",
      parentPane?.workspace_id ?? focusedWs?.workspace_id ?? "space-sub",
      false,
      term,
    );
    if (!subPane.agent) subPane.agent = "subagent";
    agents.push(subPane);
  }

  const machines: HerdrMachineInfo[] = (terminalList?.machines ?? [])
    .filter((m) => !m.temporary)
    .map((m) => ({
      name: m.name,
      ...(m.target ? { target: m.target } : {}),
      ...(m.state ? { state: m.state } : {}),
      ...(m.version !== undefined ? { version: m.version } : {}),
      ...(m.why ? { why: m.why } : {}),
    }));

  return {
    version,
    protocol: 2,
    runtime: "hc",
    focused_workspace_id: focusedWs?.workspace_id ?? null,
    focused_tab_id: focusedTabId,
    focused_pane_id: focusedPaneId,
    focused_terminal_id: focusedTerminalId,
    workspaces,
    tabs,
    panes,
    layouts,
    agents,
    ...(machines.length > 0 ? { machines } : {}),
  };
}

/**
 * Parses the output of `buildStateScript`: either an `hc` state dump starting
 * with `HC_STATE_MARKER` or a legacy `herdr api snapshot` JSON reply.
 */
export function parseStateOutput(result: ScriptResult): HerdrSnapshot | null {
  if (!result.stdout.startsWith(HC_STATE_MARKER)) {
    const parsed = parseHerdrResult(result) as { snapshot?: HerdrSnapshot };
    return parsed?.snapshot && Array.isArray(parsed.snapshot.workspaces)
      ? parsed.snapshot
      : null;
  }

  const body = result.stdout.slice(HC_STATE_MARKER.length).replace(/^\n/, "");
  const [rpcPart, viewPart] = body.split(`\n${HC_VIEW_MARKER}\n`);

  let serverStatus: { version?: string; core?: { name?: string } } | undefined;
  let terminalList:
    { terminals?: HcTerminal[]; machines?: HcMachine[] } | undefined;
  let docValue: HcDocValue | null | undefined;

  for (const line of (rpcPart ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const msg = JSON.parse(trimmed) as {
        id?: number;
        result?: unknown;
      };
      if (msg.id === 1 && msg.result && typeof msg.result === "object") {
        serverStatus = msg.result as {
          version?: string;
          core?: { name?: string };
        };
      } else if (msg.id === 2 && msg.result && typeof msg.result === "object") {
        terminalList = msg.result as {
          terminals?: HcTerminal[];
          machines?: HcMachine[];
        };
      } else if (msg.id === 3 && msg.result && typeof msg.result === "object") {
        const res = msg.result as { value?: HcDocValue | null };
        docValue = res.value ?? null;
      }
    } catch {
      // Ignore malformed lines.
    }
  }

  let view: HcViewFile | null = null;
  if (viewPart && viewPart.trim().startsWith("{")) {
    try {
      view = JSON.parse(viewPart.trim()) as HcViewFile;
    } catch {
      view = null;
    }
  }

  return synthesizeHcSnapshot(serverStatus, terminalList, docValue, view);
}
