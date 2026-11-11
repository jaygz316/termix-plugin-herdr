import { randomBytes } from "node:crypto";
import { DEFAULT_BINARY, isHcBinaryName, isPaneId } from "../shared/herdr.js";
import {
  HerdrCommandError,
  NOT_FOUND_MARK,
  PREAMBLE,
  buildHcRpcScript,
  buildHcScript,
  checkHerdrResult,
  hcScriptHead,
  parseHerdrResult,
  runScript,
  shQuote,
  type SshClientLike,
} from "./remote.js";
import {
  buildStateScript,
  parseStateOutput,
  type HcDocLayoutNode,
  type HcDocSpace,
  type HcDocTab,
  type HcDocValue,
  type HcTerminal,
  type HcViewFile,
} from "./hc-snapshot.js";

export interface HcTarget {
  binary: string;
  session: string;
}

const LEGACY_ID_RE = /^w[0-9A-Za-z]{1,16}(?::[tp][0-9A-Za-z]{1,16})?$/;
const HC_BLOCK_PANE_RE = /^(?:[A-Za-z0-9_.-]+\/)?p[0-9a-f]{8,64}$/;

/** True when an entity id belongs to legacy herdr (`w1`, `w1:t1`, `w1:p1`). */
export function isLegacyEntityId(id: unknown): boolean {
  return typeof id === "string" && LEGACY_ID_RE.test(id);
}

/**
 * Determines whether an action request targets `hc` (`herdr-core`) rather than
 * legacy `herdr`.
 */
export function shouldUseHcForAction(
  binary: string,
  actionName: string,
  params: Record<string, unknown>,
): boolean {
  if (isHcBinaryName(binary)) return true;
  if (actionName === "pane.interrupt" || actionName === "agent.pin") {
    return true;
  }
  const id =
    params.paneId ?? params.tabId ?? params.workspaceId ?? params.targetPaneId;
  if (typeof id === "string" && id.length > 0) {
    return !isLegacyEntityId(id);
  }
  return false;
}

/**
 * Builds the `sh -s` script for `GET /hosts/:hostId/sessions`, supporting both
 * `hc` (`herdr-core`) state/socket directories and legacy `herdr session list`.
 */
export function buildSessionsScript(binary: string): string {
  const hcCollect = [
    'state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/herdr-core"',
    'run_dir="${XDG_RUNTIME_DIR:-/tmp}/herdr-core"',
    "names='default'",
    'if [ -d "$state_dir" ]; then',
    '  for d in "$state_dir"/*; do [ -d "$d" ] && names="$names $(basename "$d")"; done',
    "fi",
    'if [ -d "$run_dir" ]; then',
    '  for s in "$run_dir"/*.sock; do [ -S "$s" ] && names="$names $(basename "$s" .sock)"; done',
    "fi",
    `printf '{"sessions":['`,
    "first=1",
    'for n in $(printf "%s\\n" $names | sort -u); do',
    '  case "$n" in [A-Za-z0-9_.-]*) ;; *) continue ;; esac',
    "  running=false",
    '  [ -S "$run_dir/$n.sock" ] && running=true',
    '  if [ "$first" -eq 1 ]; then first=0; else printf ","; fi',
    '  printf \'{"name":"%s","running":%s}\' "$n" "$running"',
    "done",
    `printf ']}\\n'`,
  ];

  if (isHcBinaryName(binary)) {
    return [...hcScriptHead(binary, ""), ...hcCollect, ""].join("\n");
  }

  const assign = binary.startsWith("~/")
    ? `H="$HOME"/${shQuote(binary.slice(2))}`
    : `H=${shQuote(binary)}`;
  const autoDetect =
    binary === DEFAULT_BINARY
      ? [
          'if command -v hc >/dev/null 2>&1; then HC_BIN=hc; elif command -v herdr-core >/dev/null 2>&1; then HC_BIN=herdr-core; else HC_BIN=""; fi',
          'if [ -n "$HC_BIN" ]; then',
          ...hcCollect.map((l) => `  ${l}`),
          "  exit 0",
          "fi",
        ]
      : [];

  return [
    ...PREAMBLE,
    assign,
    ...autoDetect,
    `command -v "$H" >/dev/null 2>&1 || { echo ${NOT_FOUND_MARK} >&2; exit 127; }`,
    `exec "$H" 'session' 'list' '--json'`,
    "",
  ].join("\n");
}

function randomHexId(prefix: string): string {
  return `${prefix}${randomBytes(16).toString("hex")}`;
}

function findLeafTerminal(
  node: HcDocLayoutNode | undefined,
  paneId: string,
): string | null {
  if (!node) return null;
  if (node.id === paneId) {
    return node.content?.terminal ?? node.terminalId ?? null;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findLeafTerminal(child, paneId);
      if (found) return found;
    }
  }
  if (node.first) {
    const found = findLeafTerminal(node.first, paneId);
    if (found) return found;
  }
  if (node.second) {
    const found = findLeafTerminal(node.second, paneId);
    if (found) return found;
  }
  return null;
}

async function fetchHcDocAndTerminals(
  client: SshClientLike,
  target: HcTarget,
): Promise<{
  terminals: HcTerminal[];
  docValue: HcDocValue;
  docVersion: number;
  view: HcViewFile;
}> {
  const res = await runScript(
    client,
    buildStateScript(target.binary, target.session),
  );
  checkHerdrResult(res);

  let terminals: HcTerminal[] = [];
  let docValue: HcDocValue = { spaces: [] };
  let docVersion = 0;
  let view: HcViewFile = {};

  const body = res.stdout.replace(/^__TERMIX_HC_STATE__\n?/, "");
  const [rpcPart, viewPart] = body.split("\n__TERMIX_HC_VIEW__\n");
  for (const line of (rpcPart ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const msg = JSON.parse(trimmed) as { id?: number; result?: unknown };
      if (msg.id === 2 && msg.result && typeof msg.result === "object") {
        const tl = msg.result as { terminals?: HcTerminal[] };
        if (Array.isArray(tl.terminals)) terminals = tl.terminals;
      } else if (msg.id === 3 && msg.result && typeof msg.result === "object") {
        const dg = msg.result as {
          value?: HcDocValue | null;
          version?: number;
        };
        if (dg.value && Array.isArray(dg.value.spaces)) {
          docValue = dg.value;
        }
        if (typeof dg.version === "number") docVersion = dg.version;
      }
    } catch {
      // Ignore malformed lines.
    }
  }
  if (viewPart && viewPart.trim().startsWith("{")) {
    try {
      view = JSON.parse(viewPart.trim()) as HcViewFile;
    } catch {
      view = {};
    }
  }
  return { terminals, docValue, docVersion, view };
}

/**
 * Resolves a pane id (`p<hex>` from `herdr-app` or `t<base36>` from `hc`) to
 * its underlying `hc` terminal address (`t5`, `ucloud/t4`, etc.).
 */
export async function resolveHcTerminalId(
  client: SshClientLike,
  target: HcTarget,
  paneId: string,
): Promise<string> {
  if (!HC_BLOCK_PANE_RE.test(paneId) && !paneId.includes(":p")) {
    return paneId;
  }
  const { docValue } = await fetchHcDocAndTerminals(client, target);
  for (const space of docValue.spaces ?? []) {
    for (const tab of space.tabs ?? []) {
      const found = findLeafTerminal(tab.root, paneId);
      if (found) return found;
    }
  }
  throw new HerdrCommandError(
    "pane not found",
    "HERDR_ERROR",
    "pane_not_found",
  );
}

/** Reads recent output lines from an `hc` pane or terminal. */
export async function readHcPaneOutput(
  client: SshClientLike,
  target: HcTarget,
  paneId: string,
  lines: number,
): Promise<string> {
  if (!isPaneId(paneId)) {
    throw new HerdrCommandError("Invalid pane id", "HERDR_ERROR");
  }
  const terminalId = await resolveHcTerminalId(client, target, paneId);
  const result = await runScript(
    client,
    buildHcScript(target.binary, target.session, [
      "read",
      "--lines",
      String(lines),
      terminalId,
    ]),
  );
  checkHerdrResult(result);
  return result.stdout;
}

async function saveHcDocAndView(
  client: SshClientLike,
  target: HcTarget,
  docValue: HcDocValue,
  docVersion: number,
  view?: HcViewFile,
  extraRpc: Array<{
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
  }> = [],
): Promise<void> {
  const requests = [
    ...extraRpc,
    {
      id: "doc_set",
      method: "doc.set",
      params: {
        name: "herdr-app",
        value: docValue,
        version: docVersion,
      },
    },
  ];
  const afterLines = view
    ? [
        'mkdir -p "$HOME/.config/herdr-app"',
        `printf '%s\\n' ${shQuote(JSON.stringify(view, null, 2))} > "$HOME/.config/herdr-app/view.json"`,
      ]
    : undefined;
  const res = await runScript(
    client,
    buildHcRpcScript(target.binary, target.session, requests, afterLines),
  );
  checkHerdrResult(res);
}

async function tryHerdrAppDo(
  client: SshClientLike,
  command: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const script = [
    ...PREAMBLE,
    "command -v herdr-app >/dev/null 2>&1 || exit 3",
    "herdr-app status >/dev/null 2>&1 || exit 3",
    `exec herdr-app do ${shQuote(command)} ${shQuote(JSON.stringify(args))}`,
    "",
  ].join("\n");
  const res = await runScript(client, script);
  return res.code === 0;
}

async function createHcTerminal(
  client: SshClientLike,
  target: HcTarget,
  options: {
    cwd?: string | null;
    spaceId: string;
    tabId: string;
    where: string;
  },
): Promise<string> {
  const script = buildHcRpcScript(target.binary, target.session, [
    {
      id: 1,
      method: "terminal.run",
      params: {
        keep: true,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        labels: {
          "herdr.space": options.spaceId,
          "herdr.tab": options.tabId,
          where: options.where,
        },
      },
    },
  ]);
  const res = await runScript(client, script);
  checkHerdrResult(res);
  for (const line of res.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        result?: { address?: string; terminal?: { address?: string } };
      };
      const addr = parsed.result?.address ?? parsed.result?.terminal?.address;
      if (addr) return addr;
    } catch {
      // Ignore non-JSON lines.
    }
  }
  throw new HerdrCommandError("Failed to create hc terminal", "HERDR_ERROR");
}

function collectLeafTerminals(node: HcDocLayoutNode | undefined): string[] {
  if (!node) return [];
  const out: string[] = [];
  const term = node.content?.terminal ?? node.terminalId;
  if (term) out.push(term);
  for (const child of node.children ?? []) {
    out.push(...collectLeafTerminals(child));
  }
  if (node.first) out.push(...collectLeafTerminals(node.first));
  if (node.second) out.push(...collectLeafTerminals(node.second));
  return out;
}

function splitLeafInTree(
  node: HcDocLayoutNode | undefined,
  targetPaneId: string,
  direction: "right" | "down",
  newPaneId: string,
  newTerminalId: string,
): { updated: HcDocLayoutNode; split: boolean } {
  if (!node) {
    return {
      updated: {
        id: newPaneId,
        type: "block",
        size: { weight: 1 },
        content: { terminal: newTerminalId },
      },
      split: true,
    };
  }
  const desiredType = direction === "down" ? "column" : "row";
  if (
    node.id === targetPaneId &&
    (!node.children || node.children.length === 0)
  ) {
    const newLeaf: HcDocLayoutNode = {
      id: newPaneId,
      type: "block",
      size: { weight: 1 },
      content: { terminal: newTerminalId },
    };
    return {
      updated: {
        id: randomHexId("s"),
        type: desiredType,
        size: node.size ?? { weight: 1 },
        children: [{ ...node, size: { weight: 1 } }, newLeaf],
      },
      split: true,
    };
  }
  if (Array.isArray(node.children)) {
    let anySplit = false;
    const nextChildren = node.children.map((child) => {
      if (anySplit) return child;
      const res = splitLeafInTree(
        child,
        targetPaneId,
        direction,
        newPaneId,
        newTerminalId,
      );
      if (res.split) anySplit = true;
      return res.updated;
    });
    return { updated: { ...node, children: nextChildren }, split: anySplit };
  }
  return { updated: node, split: false };
}

function removeLeafFromTree(
  node: HcDocLayoutNode | undefined,
  targetPaneId: string,
): { updated: HcDocLayoutNode | undefined; removedTerminal: string | null } {
  if (!node) return { updated: undefined, removedTerminal: null };
  if (
    node.id === targetPaneId &&
    (!node.children || node.children.length === 0)
  ) {
    return {
      updated: undefined,
      removedTerminal: node.content?.terminal ?? node.terminalId ?? null,
    };
  }
  if (Array.isArray(node.children)) {
    let removedTerminal: string | null = null;
    const kept: HcDocLayoutNode[] = [];
    for (const child of node.children) {
      if (!removedTerminal) {
        const res = removeLeafFromTree(child, targetPaneId);
        if (res.removedTerminal !== null || res.updated !== child) {
          removedTerminal = res.removedTerminal;
          if (res.updated) kept.push(res.updated);
          continue;
        }
      }
      kept.push(child);
    }
    if (kept.length === 0) return { updated: undefined, removedTerminal };
    return { updated: { ...node, children: kept }, removedTerminal };
  }
  return { updated: node, removedTerminal: null };
}

function swapLeavesInTree(
  node: HcDocLayoutNode | undefined,
  paneA: string,
  paneB: string,
): void {
  const leaves: HcDocLayoutNode[] = [];
  const walk = (n: HcDocLayoutNode | undefined) => {
    if (!n) return;
    if (!n.children || n.children.length === 0) leaves.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(node);
  const a = leaves.find((l) => l.id === paneA);
  const b = leaves.find((l) => l.id === paneB);
  if (a && b) {
    const tmpContent = a.content;
    a.content = b.content;
    b.content = tmpContent;
  }
}

function textToHcKeys(raw: string): string[] | null {
  const out: string[] = [];
  for (const ch of raw) {
    if (ch === " ") out.push("space");
    else if (ch === "\n" || ch === "\r") out.push("enter");
    else if (ch === "\t") out.push("tab");
    else if (ch >= "!" && ch <= "~") out.push(ch);
    else return null;
  }
  return out;
}

/**
 * Executes a validated herdr action against `hc` (`herdr-core`) and/or
 * `herdr-app`.
 */
export async function executeHcAction(
  client: SshClientLike,
  target: HcTarget,
  actionName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (actionName) {
    case "agent.prompt": {
      const termId = await resolveHcTerminalId(
        client,
        target,
        String(params.paneId),
      );
      return parseHerdrResult(
        await runScript(
          client,
          buildHcScript(target.binary, target.session, [
            "send",
            "--json",
            termId,
            String(params.text),
          ]),
        ),
      );
    }

    case "pane.run": {
      const termId = await resolveHcTerminalId(
        client,
        target,
        String(params.paneId),
      );
      return parseHerdrResult(
        await runScript(
          client,
          buildHcScript(target.binary, target.session, [
            "send",
            "--force",
            "--json",
            termId,
            String(params.command),
          ]),
        ),
      );
    }

    case "pane.sendKeys": {
      const termId = await resolveHcTerminalId(
        client,
        target,
        String(params.paneId),
      );
      const keyList = params.keys as string[];
      return parseHerdrResult(
        await runScript(
          client,
          buildHcScript(target.binary, target.session, [
            "keys",
            "--json",
            termId,
            ...keyList,
          ]),
        ),
      );
    }

    case "pane.sendText": {
      const termId = await resolveHcTerminalId(
        client,
        target,
        String(params.paneId),
      );
      const rawText = String(params.text);
      const keys = textToHcKeys(rawText);
      if (keys && keys.length > 0 && keys.length <= 256) {
        return parseHerdrResult(
          await runScript(
            client,
            buildHcScript(target.binary, target.session, [
              "keys",
              "--json",
              termId,
              ...keys,
            ]),
          ),
        );
      }
      return parseHerdrResult(
        await runScript(
          client,
          buildHcScript(target.binary, target.session, [
            "send",
            "--force",
            "--json",
            termId,
            rawText,
          ]),
        ),
      );
    }

    case "pane.interrupt": {
      const termId = await resolveHcTerminalId(
        client,
        target,
        String(params.paneId),
      );
      return parseHerdrResult(
        await runScript(
          client,
          buildHcScript(target.binary, target.session, [
            "interrupt",
            "--json",
            termId,
          ]),
        ),
      );
    }

    case "agent.pin": {
      const termId = await resolveHcTerminalId(
        client,
        target,
        String(params.paneId),
      );
      const pinned = params.pinned !== false;
      return parseHerdrResult(
        await runScript(
          client,
          buildHcScript(target.binary, target.session, [
            "label",
            "--json",
            termId,
            pinned ? "herdr.pinned=true" : "herdr.pinned=",
          ]),
        ),
      );
    }

    case "agent.start": {
      const termId = await resolveHcTerminalId(
        client,
        target,
        String(params.paneId),
      );
      const kind = String(params.kind);
      return parseHerdrResult(
        await runScript(
          client,
          buildHcScript(target.binary, target.session, [
            "send",
            "--force",
            "--json",
            termId,
            kind,
          ]),
        ),
      );
    }

    case "workspace.focus": {
      const wsId = String(params.workspaceId);
      if (await tryHerdrAppDo(client, "space.select", { id: wsId })) {
        return { workspace_id: wsId };
      }
      const { view } = await fetchHcDocAndTerminals(client, target);
      view.active = wsId;
      await runScript(
        client,
        [
          ...PREAMBLE,
          'mkdir -p "$HOME/.config/herdr-app"',
          `printf '%s\\n' ${shQuote(JSON.stringify(view, null, 2))} > "$HOME/.config/herdr-app/view.json"`,
          "",
        ].join("\n"),
      );
      return { workspace_id: wsId };
    }

    case "workspace.create": {
      const name = typeof params.label === "string" ? params.label.trim() : "";
      const cwd = typeof params.cwd === "string" ? params.cwd.trim() : "";
      if (
        await tryHerdrAppDo(client, "space.new", {
          ...(name ? { name } : {}),
          ...(cwd ? { folder: cwd } : {}),
        })
      ) {
        return { ok: true };
      }
      const { docValue, docVersion, view } = await fetchHcDocAndTerminals(
        client,
        target,
      );
      const spId = randomHexId("sp");
      const tbId = randomHexId("tb");
      const paneId = randomHexId("p");
      const termAddr = await createHcTerminal(client, target, {
        cwd: cwd || null,
        spaceId: spId,
        tabId: tbId,
        where: `${name || "space"} / 1`,
      });
      const newSpace: HcDocSpace = {
        id: spId,
        name: name || "",
        folder: cwd || "~",
        tabs: [
          {
            id: tbId,
            name: name || "1",
            root: {
              id: tbId,
              type: "row",
              children: [
                {
                  id: paneId,
                  type: "block",
                  size: { weight: 1 },
                  content: { terminal: termAddr },
                },
              ],
            },
          },
        ],
      };
      docValue.spaces = [...(docValue.spaces ?? []), newSpace];
      view.active = spId;
      view.spaces = { ...(view.spaces ?? {}), [spId]: tbId };
      view.tabs = {
        ...(view.tabs ?? {}),
        [tbId]: { focused: paneId, zoomed: null, settled: null },
      };
      await saveHcDocAndView(client, target, docValue, docVersion, view);
      return { workspace_id: spId, terminal_id: termAddr };
    }

    case "workspace.rename": {
      const wsId = String(params.workspaceId);
      const name = String(params.label).trim();
      if (await tryHerdrAppDo(client, "space.rename", { id: wsId, name })) {
        return { workspace_id: wsId, label: name };
      }
      const { docValue, docVersion } = await fetchHcDocAndTerminals(
        client,
        target,
      );
      const space = (docValue.spaces ?? []).find((s) => s.id === wsId);
      if (!space) {
        throw new HerdrCommandError("space not found", "HERDR_ERROR");
      }
      space.name = name;
      await saveHcDocAndView(client, target, docValue, docVersion);
      return { workspace_id: wsId, label: name };
    }

    case "workspace.close": {
      const wsId = String(params.workspaceId);
      if (await tryHerdrAppDo(client, "space.close", { id: wsId })) {
        return { workspace_id: wsId };
      }
      const { docValue, docVersion, view } = await fetchHcDocAndTerminals(
        client,
        target,
      );
      const idx = (docValue.spaces ?? []).findIndex((s) => s.id === wsId);
      if (idx < 0) {
        throw new HerdrCommandError("space not found", "HERDR_ERROR");
      }
      const [removed] = (docValue.spaces ?? []).splice(idx, 1);
      const killRpc = (removed.tabs ?? [])
        .flatMap((t) => collectLeafTerminals(t.root))
        .map((terminal, i) => ({
          id: `kill_${i}`,
          method: "terminal.kill",
          params: { terminal },
        }));
      if (view.active === wsId) {
        view.active = docValue.spaces?.[0]?.id ?? null;
      }
      await saveHcDocAndView(
        client,
        target,
        docValue,
        docVersion,
        view,
        killRpc,
      );
      return { workspace_id: wsId };
    }

    case "tab.focus": {
      const tabId = String(params.tabId);
      if (await tryHerdrAppDo(client, "tab.select", { id: tabId })) {
        return { tab_id: tabId };
      }
      const { docValue, view } = await fetchHcDocAndTerminals(client, target);
      const space = (docValue.spaces ?? []).find((s) =>
        (s.tabs ?? []).some((t) => t.id === tabId),
      );
      if (space) {
        view.active = space.id;
        view.spaces = { ...(view.spaces ?? {}), [space.id]: tabId };
        await runScript(
          client,
          [
            ...PREAMBLE,
            'mkdir -p "$HOME/.config/herdr-app"',
            `printf '%s\\n' ${shQuote(JSON.stringify(view, null, 2))} > "$HOME/.config/herdr-app/view.json"`,
            "",
          ].join("\n"),
        );
      }
      return { tab_id: tabId };
    }

    case "tab.create": {
      const wsId = String(params.workspaceId);
      const name = typeof params.label === "string" ? params.label.trim() : "";
      const cwd = typeof params.cwd === "string" ? params.cwd.trim() : "";
      if (
        await tryHerdrAppDo(client, "tab.new", {
          spaceId: wsId,
          ...(name ? { name } : {}),
          ...(cwd ? { cwd } : {}),
        })
      ) {
        return { workspace_id: wsId };
      }
      const { docValue, docVersion, view } = await fetchHcDocAndTerminals(
        client,
        target,
      );
      const space = (docValue.spaces ?? []).find((s) => s.id === wsId);
      if (!space) {
        throw new HerdrCommandError("space not found", "HERDR_ERROR");
      }
      const tbId = randomHexId("tb");
      const paneId = randomHexId("p");
      const tabName = name || String((space.tabs?.length ?? 0) + 1);
      const termAddr = await createHcTerminal(client, target, {
        cwd: cwd || space.folder || null,
        spaceId: wsId,
        tabId: tbId,
        where: `${space.name || "space"} / ${tabName}`,
      });
      const newTab: HcDocTab = {
        id: tbId,
        name: tabName,
        root: {
          id: tbId,
          type: "row",
          children: [
            {
              id: paneId,
              type: "block",
              size: { weight: 1 },
              content: { terminal: termAddr },
            },
          ],
        },
      };
      space.tabs = [...(space.tabs ?? []), newTab];
      view.active = wsId;
      view.spaces = { ...(view.spaces ?? {}), [wsId]: tbId };
      view.tabs = {
        ...(view.tabs ?? {}),
        [tbId]: { focused: paneId, zoomed: null, settled: null },
      };
      await saveHcDocAndView(client, target, docValue, docVersion, view);
      return { tab_id: tbId, terminal_id: termAddr };
    }

    case "tab.rename": {
      const tabId = String(params.tabId);
      const name = String(params.label).trim();
      if (await tryHerdrAppDo(client, "tab.rename", { id: tabId, name })) {
        return { tab_id: tabId, label: name };
      }
      const { docValue, docVersion } = await fetchHcDocAndTerminals(
        client,
        target,
      );
      for (const space of docValue.spaces ?? []) {
        const tab = (space.tabs ?? []).find((t) => t.id === tabId);
        if (tab) {
          tab.name = name;
          await saveHcDocAndView(client, target, docValue, docVersion);
          return { tab_id: tabId, label: name };
        }
      }
      throw new HerdrCommandError("tab not found", "HERDR_ERROR");
    }

    case "tab.close": {
      const tabId = String(params.tabId);
      if (await tryHerdrAppDo(client, "tab.close", { id: tabId })) {
        return { tab_id: tabId };
      }
      const { docValue, docVersion, view } = await fetchHcDocAndTerminals(
        client,
        target,
      );
      for (const space of docValue.spaces ?? []) {
        const idx = (space.tabs ?? []).findIndex((t) => t.id === tabId);
        if (idx >= 0) {
          const [removed] = (space.tabs ?? []).splice(idx, 1);
          const killRpc = collectLeafTerminals(removed.root).map(
            (terminal, i) => ({
              id: `kill_${i}`,
              method: "terminal.kill",
              params: { terminal },
            }),
          );
          if (view.spaces?.[space.id] === tabId) {
            view.spaces[space.id] = space.tabs?.[0]?.id ?? "";
          }
          await saveHcDocAndView(
            client,
            target,
            docValue,
            docVersion,
            view,
            killRpc,
          );
          return { tab_id: tabId };
        }
      }
      throw new HerdrCommandError("tab not found", "HERDR_ERROR");
    }

    case "pane.focus": {
      const paneId = String(params.paneId);
      const { terminals, docValue, view } = await fetchHcDocAndTerminals(
        client,
        target,
      );
      let termId: string | null = null;
      for (const space of docValue.spaces ?? []) {
        for (const tab of space.tabs ?? []) {
          const found = findLeafTerminal(tab.root, paneId);
          if (found) {
            termId = found;
            view.active = space.id;
            view.spaces = { ...(view.spaces ?? {}), [space.id]: tab.id };
            view.tabs = {
              ...(view.tabs ?? {}),
              [tab.id]: {
                ...(view.tabs?.[tab.id] ?? {}),
                focused: paneId,
              },
            };
          }
        }
      }
      if (!termId && !HC_BLOCK_PANE_RE.test(paneId)) {
        termId = paneId;
      }
      await tryHerdrAppDo(client, "pane.focus", { paneId });

      const term = terminals.find((t) => t.address === termId);
      const extraCmds: string[] = [
        'mkdir -p "$HOME/.config/herdr-app"',
        `printf '%s\\n' ${shQuote(JSON.stringify(view, null, 2))} > "$HOME/.config/herdr-app/view.json"`,
      ];
      if (term && typeof term.turn === "number" && termId) {
        await runScript(
          client,
          buildHcRpcScript(
            target.binary,
            target.session,
            [
              {
                id: "seen",
                method: "terminal.label",
                params: {
                  terminal: termId,
                  labels: { "herdr.seen": String(term.turn) },
                },
              },
            ],
            extraCmds,
          ),
        );
      } else {
        await runScript(client, [...PREAMBLE, ...extraCmds, ""].join("\n"));
      }
      return { pane_id: paneId, ...(termId ? { terminal_id: termId } : {}) };
    }

    case "pane.rename": {
      const paneId = String(params.paneId);
      const termId = await resolveHcTerminalId(client, target, paneId);
      const newLabel = params.clear === true ? "" : String(params.label).trim();
      return parseHerdrResult(
        await runScript(
          client,
          buildHcRpcScript(target.binary, target.session, [
            {
              id: 1,
              method: "terminal.label",
              params: {
                terminal: termId,
                labels: { "herdr.label": newLabel || null },
              },
            },
          ]),
        ),
      );
    }

    case "pane.split": {
      const paneId = String(params.paneId);
      const dir = params.direction === "down" ? "down" : "right";
      if (
        await tryHerdrAppDo(client, "pane.split", {
          paneId,
          direction: dir,
        })
      ) {
        return { pane_id: paneId, direction: dir };
      }
      const { docValue, docVersion, view } = await fetchHcDocAndTerminals(
        client,
        target,
      );
      for (const space of docValue.spaces ?? []) {
        for (const tab of space.tabs ?? []) {
          if (findLeafTerminal(tab.root, paneId)) {
            const newPaneId = randomHexId("p");
            const termAddr = await createHcTerminal(client, target, {
              cwd: space.folder || null,
              spaceId: space.id,
              tabId: tab.id,
              where: `${space.name || "space"} / ${tab.name || "1"}`,
            });
            const res = splitLeafInTree(
              tab.root,
              paneId,
              dir,
              newPaneId,
              termAddr,
            );
            tab.root = res.updated;
            view.tabs = {
              ...(view.tabs ?? {}),
              [tab.id]: {
                ...(view.tabs?.[tab.id] ?? {}),
                focused: newPaneId,
              },
            };
            await saveHcDocAndView(client, target, docValue, docVersion, view);
            return { pane_id: newPaneId, terminal_id: termAddr };
          }
        }
      }
      throw new HerdrCommandError(
        "pane not found",
        "HERDR_ERROR",
        "pane_not_found",
      );
    }

    case "pane.zoom": {
      const paneId = String(params.paneId);
      if (await tryHerdrAppDo(client, "pane.zoom", { paneId })) {
        return { pane_id: paneId };
      }
      const { docValue, view } = await fetchHcDocAndTerminals(client, target);
      for (const space of docValue.spaces ?? []) {
        for (const tab of space.tabs ?? []) {
          if (findLeafTerminal(tab.root, paneId)) {
            const cur = view.tabs?.[tab.id]?.zoomed;
            view.tabs = {
              ...(view.tabs ?? {}),
              [tab.id]: {
                ...(view.tabs?.[tab.id] ?? {}),
                focused: paneId,
                zoomed: cur === paneId ? null : paneId,
              },
            };
            await runScript(
              client,
              [
                ...PREAMBLE,
                'mkdir -p "$HOME/.config/herdr-app"',
                `printf '%s\\n' ${shQuote(JSON.stringify(view, null, 2))} > "$HOME/.config/herdr-app/view.json"`,
                "",
              ].join("\n"),
            );
            return { pane_id: paneId };
          }
        }
      }
      return { pane_id: paneId };
    }

    case "pane.swap": {
      const paneId = String(params.paneId);
      const targetPaneId =
        typeof params.targetPaneId === "string"
          ? params.targetPaneId
          : undefined;
      if (
        await tryHerdrAppDo(client, "pane.swap", {
          paneId,
          ...(targetPaneId ? { targetPaneId } : {}),
          ...(typeof params.direction === "string"
            ? { direction: params.direction }
            : {}),
        })
      ) {
        return { pane_id: paneId };
      }
      if (targetPaneId) {
        const { docValue, docVersion } = await fetchHcDocAndTerminals(
          client,
          target,
        );
        for (const space of docValue.spaces ?? []) {
          for (const tab of space.tabs ?? []) {
            swapLeavesInTree(tab.root, paneId, targetPaneId);
          }
        }
        await saveHcDocAndView(client, target, docValue, docVersion);
      }
      return { pane_id: paneId };
    }

    case "pane.resize": {
      return { pane_id: String(params.paneId) };
    }

    case "pane.close": {
      const paneId = String(params.paneId);
      if (await tryHerdrAppDo(client, "pane.close", { paneId })) {
        return { pane_id: paneId };
      }
      if (!HC_BLOCK_PANE_RE.test(paneId) && !paneId.includes(":p")) {
        return parseHerdrResult(
          await runScript(
            client,
            buildHcScript(target.binary, target.session, [
              "kill",
              "--json",
              paneId,
            ]),
          ),
        );
      }
      const { docValue, docVersion, view } = await fetchHcDocAndTerminals(
        client,
        target,
      );
      for (const space of docValue.spaces ?? []) {
        for (let i = 0; i < (space.tabs ?? []).length; i++) {
          const tab = space.tabs![i];
          const res = removeLeafFromTree(tab.root, paneId);
          if (res.removedTerminal !== null || res.updated !== tab.root) {
            if (!res.updated) {
              space.tabs!.splice(i, 1);
            } else {
              tab.root = res.updated;
            }
            const killRpc = res.removedTerminal
              ? [
                  {
                    id: "kill_pane",
                    method: "terminal.kill",
                    params: { terminal: res.removedTerminal },
                  },
                ]
              : [];
            await saveHcDocAndView(
              client,
              target,
              docValue,
              docVersion,
              view,
              killRpc,
            );
            return { pane_id: paneId };
          }
        }
      }
      throw new HerdrCommandError(
        "pane not found",
        "HERDR_ERROR",
        "pane_not_found",
      );
    }

    case "worktree.create": {
      const wsId = String(params.workspaceId);
      const branchName = String(params.branch);
      const labelName =
        typeof params.label === "string" && params.label.trim()
          ? params.label.trim()
          : branchName;
      const { docValue } = await fetchHcDocAndTerminals(client, target);
      const space = (docValue.spaces ?? []).find((s) => s.id === wsId);
      const folder = space?.folder || "~";
      const slug = branchName.replace(/[^A-Za-z0-9._-]/g, "-");
      const wtScript = [
        ...PREAMBLE,
        `repo_dir=${folder.startsWith("~/") ? `"$HOME"/${shQuote(folder.slice(2))}` : folder === "~" ? '"$HOME"' : shQuote(folder)}`,
        'cd "$repo_dir" || exit 1',
        'repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo \'{"error":{"code":"not_git_repo","message":"workspace folder is not a git repository"}}\' >&2; exit 1; }',
        'repo_name=$(basename "$repo_root")',
        `wt_path="$HOME/.herdr/worktrees/$repo_name/${slug}"`,
        'mkdir -p "$(dirname "$wt_path")"',
        `if git show-ref --verify --quiet ${shQuote(`refs/heads/${branchName}`)}; then`,
        `  git worktree add "$wt_path" ${shQuote(branchName)} >&2 || exit 1`,
        "else",
        `  git worktree add -b ${shQuote(branchName)} "$wt_path" >&2 || exit 1`,
        "fi",
        'printf "%s" "$wt_path"',
        "",
      ].join("\n");
      const wtRes = await runScript(client, wtScript);
      checkHerdrResult(wtRes);
      const wtPath = wtRes.stdout.trim();
      return executeHcAction(client, target, "workspace.create", {
        label: labelName,
        cwd: wtPath,
      });
    }

    case "worktree.remove": {
      const wsId = String(params.workspaceId);
      return executeHcAction(client, target, "workspace.close", {
        workspaceId: wsId,
      });
    }

    default:
      throw new HerdrCommandError(
        `Unsupported action: ${actionName}`,
        "HERDR_ERROR",
      );
  }
}

/**
 * Reads the current `HerdrSnapshot` from a host (auto-detecting `hc` vs
 * legacy `herdr`).
 */
export async function readHostSnapshot(
  client: SshClientLike,
  target: HcTarget,
) {
  const result = await runScript(
    client,
    buildStateScript(target.binary, target.session),
  );
  const snapshot = parseStateOutput(result);
  if (!snapshot || !Array.isArray(snapshot.workspaces)) {
    throw new HerdrCommandError(
      "herdr returned an unexpected snapshot",
      "HERDR_ERROR",
    );
  }
  return snapshot;
}
