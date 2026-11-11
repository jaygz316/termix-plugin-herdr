import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  ListRowAction,
  cn,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import {
  ArrowUpDown,
  Bot,
  Check,
  FolderPlus,
  GitBranch,
  Monitor,
  OctagonX,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Server,
  X,
} from "lucide-react";
import type {
  AgentStatus,
  HerdrMachineInfo,
  HerdrPane,
  HerdrSnapshot,
  HerdrWorkspace,
} from "../shared/herdr";
import type { RunAction } from "./Navigator";

export type SidebarMode = "expanded" | "rail" | "hidden";
export type AgentSortMode = "priority" | "grouped";

interface HerdrAppSidebarProps {
  snapshot: HerdrSnapshot;
  run: RunAction;
  mode: SidebarMode;
  onModeChange: (next: SidebarMode) => void;
  agentSort: AgentSortMode;
  onAgentSortChange: (next: AgentSortMode) => void;
}

const DEFAULT_SIDEBAR_WIDTH = 240;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 480;
const SNAP_TO_RAIL_WIDTH = 110;
const DEFAULT_SPLIT_RATIO = 0.52;
const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;

const STORAGE_WIDTH_KEY = "termix.herdr.sidebarWidth";
const STORAGE_SPLIT_KEY = "termix.herdr.sidebarSplitRatio";

function readStoredNumber(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    const raw =
      typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (!raw) return fallback;
    const num = Number(raw);
    return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredNumber(key: string, value: number): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, String(value));
    }
  } catch {
    // Ignore storage errors in private browsing or restricted iframes.
  }
}

const SPACE_COLORS = [
  "#22a99a",
  "#e3814f",
  "#5b8def",
  "#8b7cf6",
  "#3fae6a",
  "#d9649a",
];

const QUICK_APPROVAL_KEYS: Array<{ label: string; keys: string[] }> = [
  { label: "Enter", keys: ["enter"] },
  { label: "y", keys: ["y", "enter"] },
  { label: "n", keys: ["n", "enter"] },
  { label: "Esc", keys: ["esc"] },
  { label: "1", keys: ["1"] },
  { label: "2", keys: ["2"] },
];

function spaceColor(index: number): string {
  return SPACE_COLORS[index % SPACE_COLORS.length];
}

function spaceInitial(label: string): string {
  const trimmed = label.replace(/^[A-Za-z0-9_.-]+:\s*/, "").trim();
  return (trimmed[0] || "S").toUpperCase();
}

function displaySpaceLabel(ws: HerdrWorkspace): string {
  if (ws.machine && ws.label.startsWith(`${ws.machine}: `)) {
    return ws.label.slice(ws.machine.length + 2);
  }
  return ws.label;
}

function paneTitle(pane: HerdrPane): string {
  if (pane.label) return pane.label;
  if (pane.agent) return pane.agent;
  if (pane.terminal_title_stripped) return pane.terminal_title_stripped;
  const cwd = pane.foreground_cwd ?? pane.cwd;
  return cwd ? (cwd.split("/").filter(Boolean).pop() ?? cwd) : pane.pane_id;
}

function StatusIndicator({ status }: { status: AgentStatus }) {
  const { t } = useTranslation();
  if (status === "blocked") {
    return (
      <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
        {t("chrome.needsYou")}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="shrink-0 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
        {t("status.error")}
      </span>
    );
  }
  if (status === "working") {
    return (
      <span
        className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-amber-400"
        title={t("status.working")}
      />
    );
  }
  if (status === "done") {
    return (
      <span
        className="inline-block size-2 shrink-0 rounded-full bg-emerald-400"
        title={t("status.done")}
      />
    );
  }
  if (status === "idle") {
    return (
      <span
        className="inline-block size-2 shrink-0 rounded-full border border-muted-foreground/50"
        title={t("status.idle")}
      />
    );
  }
  return null;
}

function SpaceStatusDot({ status }: { status: AgentStatus }) {
  if (status === "blocked") {
    return <span className="size-2 shrink-0 rounded-full bg-amber-400" />;
  }
  if (status === "error") {
    return <span className="size-2 shrink-0 rounded-full bg-red-400" />;
  }
  if (status === "working") {
    return (
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-amber-400/80" />
    );
  }
  if (status === "done") {
    return <span className="size-2 shrink-0 rounded-full bg-emerald-400" />;
  }
  return null;
}

/**
 * Left sidebar that mirrors the native `herdr-app` desktop layout (`mods/spaces`
 * on top, `mods/agents` on bottom, collapsible to a 44px numbered space rail),
 * with mouse-adjustable width, vertical split ratio, and quick search filter.
 */
export function HerdrAppSidebar({
  snapshot,
  run,
  mode,
  onModeChange,
  agentSort,
  onAgentSortChange,
}: HerdrAppSidebarProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const sidebarRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    readStoredNumber(
      STORAGE_WIDTH_KEY,
      DEFAULT_SIDEBAR_WIDTH,
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH,
    ),
  );
  const [splitRatio, setSplitRatio] = useState<number>(() =>
    readStoredNumber(
      STORAGE_SPLIT_KEY,
      DEFAULT_SPLIT_RATIO,
      MIN_SPLIT_RATIO,
      MAX_SPLIT_RATIO,
    ),
  );
  const [draggingWidth, setDraggingWidth] = useState(false);
  const [draggingSplit, setDraggingSplit] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [spaceName, setSpaceName] = useState("");
  const [spaceCwd, setSpaceCwd] = useState("");
  const [renamingSpaceId, setRenamingSpaceId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [worktreeForWs, setWorktreeForWs] = useState<string | null>(null);
  const [wtBranch, setWtBranch] = useState("");

  useEffect(() => {
    writeStoredNumber(STORAGE_WIDTH_KEY, sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    writeStoredNumber(STORAGE_SPLIT_KEY, splitRatio);
  }, [splitRatio]);

  function startHorizontalResize(event: React.MouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = mode === "rail" ? 44 : sidebarWidth;
    setDraggingWidth(true);

    const onMove = (moveEvent: MouseEvent) => {
      const next = startWidth + (moveEvent.clientX - startX);
      if (next < SNAP_TO_RAIL_WIDTH) {
        if (mode !== "rail") onModeChange("rail");
        return;
      }
      if (mode === "rail") onModeChange("expanded");
      setSidebarWidth(
        Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, next)),
      );
    };

    const onUp = () => {
      setDraggingWidth(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startVerticalSplitResize(event: React.MouseEvent) {
    event.preventDefault();
    const container = bodyRef.current;
    if (!container) return;
    setDraggingSplit(true);

    const onMove = (moveEvent: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;
      const ratio = (moveEvent.clientY - rect.top) / rect.height;
      setSplitRatio(
        Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio)),
      );
    };

    const onUp = () => {
      setDraggingSplit(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (mode === "hidden") return null;

  const allWorkspaces = [...snapshot.workspaces].sort(
    (a, b) => a.number - b.number,
  );
  const workspaceById = new Map(
    allWorkspaces.map((ws) => [ws.workspace_id, ws]),
  );

  if (mode === "rail") {
    return (
      <aside
        className="relative flex w-11 shrink-0 flex-col items-center justify-between border-r border-border bg-background/60 py-2 select-none"
        data-testid="herdr-app-rail"
      >
        <div className="flex flex-col items-center gap-1.5">
          <ListRowAction
            label={t("toolbar.sidebarExpand")}
            onClick={() => onModeChange("expanded")}
          >
            <PanelLeftOpen className="size-4" />
          </ListRowAction>
          <div className="my-0.5 h-px w-6 bg-border" />
          {allWorkspaces.map((ws, idx) => {
            const color = spaceColor(idx);
            return (
              <button
                key={ws.workspace_id}
                type="button"
                title={ws.label}
                onClick={() =>
                  void run("workspace.focus", { workspaceId: ws.workspace_id })
                }
                className={cn(
                  "relative flex size-7 items-center justify-center rounded text-xs font-semibold transition-colors",
                  ws.focused
                    ? "ring-2 ring-accent-brand"
                    : "opacity-75 hover:opacity-100",
                )}
                style={{
                  backgroundColor: `${color}22`,
                  color,
                }}
              >
                {ws.number}
                {ws.agent_status !== "unknown" &&
                  ws.agent_status !== "idle" && (
                    <span className="absolute -right-0.5 -top-0.5">
                      <SpaceStatusDot status={ws.agent_status} />
                    </span>
                  )}
              </button>
            );
          })}
          <button
            type="button"
            title={t("chrome.newSpace")}
            aria-label={t("chrome.newSpace")}
            onClick={() => void run("workspace.create")}
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        <button
          type="button"
          title={t("chrome.agents")}
          onClick={() => onModeChange("expanded")}
          className="relative flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Bot className="size-4" />
          {snapshot.agents.some(
            (a) => a.agent_status === "blocked" || a.agent_status === "error",
          ) && (
            <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-amber-400" />
          )}
        </button>

        {/* Drag handle on the rail's right edge to pull it open with the mouse */}
        <div
          role="separator"
          aria-orientation="vertical"
          title={t("chrome.resizeSidebar")}
          onMouseDown={startHorizontalResize}
          onDoubleClick={() => {
            setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
            onModeChange("expanded");
          }}
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-accent-brand/50"
        />
      </aside>
    );
  }

  const normalizedFilter = searchQuery.trim().toLowerCase();
  const workspaces = normalizedFilter
    ? allWorkspaces.filter((ws) => {
        const hay = [
          ws.label,
          ws.machine ?? "",
          ws.folder ?? "",
          ws.worktree?.branch ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(normalizedFilter);
      })
    : allWorkspaces;

  const filteredAgents = normalizedFilter
    ? snapshot.agents.filter((a) => {
        const ws = workspaceById.get(a.workspace_id);
        const hay = [
          paneTitle(a),
          a.agent ?? "",
          a.status_msg ?? "",
          a.machine ?? "",
          ws?.label ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(normalizedFilter);
      })
    : snapshot.agents;

  // Group workspaces by machine: local ("This computer") first, then remote machines
  const localSpaces = workspaces.filter((w) => !w.machine);
  const remoteMachineNames = new Set<string>();
  if (!normalizedFilter) {
    for (const m of snapshot.machines ?? []) {
      if (m.name) remoteMachineNames.add(m.name);
    }
  }
  for (const w of workspaces) {
    if (w.machine) remoteMachineNames.add(w.machine);
  }
  const machineInfoMap = new Map<string, HerdrMachineInfo>(
    (snapshot.machines ?? []).map((m) => [m.name, m]),
  );
  const showMachineHeaders = remoteMachineNames.size > 0;

  // Organize agents into Pinned + Priority or Grouped sections
  const topAgents = filteredAgents.filter((a) => !a.parent_id);
  const childrenByParent = new Map<string, HerdrPane[]>();
  for (const a of filteredAgents) {
    if (!a.parent_id) continue;
    const list = childrenByParent.get(a.parent_id) ?? [];
    list.push(a);
    childrenByParent.set(a.parent_id, list);
  }

  const pinnedAgents = topAgents.filter((a) => a.pinned);
  const unpinnedAgents = topAgents.filter((a) => !a.pinned);

  const agentSections: Array<{ title: string; items: HerdrPane[] }> = [];
  if (pinnedAgents.length > 0) {
    agentSections.push({ title: t("chrome.pinned"), items: pinnedAgents });
  }

  if (agentSort === "priority") {
    const needsYou = unpinnedAgents.filter(
      (a) => a.agent_status === "blocked" || a.agent_status === "error",
    );
    const done = unpinnedAgents.filter((a) => a.agent_status === "done");
    const working = unpinnedAgents.filter((a) => a.agent_status === "working");
    const idle = unpinnedAgents.filter(
      (a) => a.agent_status === "idle" || a.agent_status === "unknown",
    );
    if (needsYou.length > 0) {
      agentSections.push({ title: t("chrome.needsYou"), items: needsYou });
    }
    if (done.length > 0) {
      agentSections.push({ title: t("chrome.done"), items: done });
    }
    if (working.length > 0) {
      agentSections.push({ title: t("chrome.working"), items: working });
    }
    if (idle.length > 0) {
      agentSections.push({ title: t("chrome.idle"), items: idle });
    }
  } else {
    for (const ws of allWorkspaces) {
      const inSpace = unpinnedAgents.filter(
        (a) => a.workspace_id === ws.workspace_id,
      );
      if (inSpace.length > 0) {
        agentSections.push({ title: ws.label, items: inSpace });
      }
    }
  }

  async function confirmCloseSpace(ws: HerdrWorkspace) {
    const ok = await confirm({
      title: t("navigator.confirm.workspace.close", { name: ws.label }),
      description: t("navigator.confirm.description"),
      confirmLabel: t("navigator.close"),
      destructive: true,
    });
    if (ok) {
      await run("workspace.close", { workspaceId: ws.workspace_id });
    }
  }

  function renderSpaceRow(ws: HerdrWorkspace, colorIndex: number) {
    const color = spaceColor(colorIndex);
    const label = displaySpaceLabel(ws);
    const isRenaming = renamingSpaceId === ws.workspace_id;

    return (
      <div key={ws.workspace_id} className="flex flex-col">
        {isRenaming ? (
          <form
            className="flex items-center gap-1 px-2 py-1"
            onSubmit={(e) => {
              e.preventDefault();
              const next = renameDraft.trim();
              setRenamingSpaceId(null);
              if (next) {
                void run("workspace.rename", {
                  workspaceId: ws.workspace_id,
                  label: next,
                });
              }
            }}
          >
            <input
              autoFocus
              aria-label={t("navigator.newName")}
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setRenamingSpaceId(null)}
              className="h-6 min-w-0 flex-1 rounded border border-border bg-transparent px-1.5 text-xs"
            />
            <ListRowAction label={t("navigator.save")} type="submit">
              <Check className="size-3" />
            </ListRowAction>
            <ListRowAction
              label={t("navigator.cancel")}
              type="button"
              onClick={() => setRenamingSpaceId(null)}
            >
              <X className="size-3" />
            </ListRowAction>
          </form>
        ) : (
          <div
            role="button"
            tabIndex={0}
            title={ws.folder ? `${label} (${ws.folder})` : label}
            onClick={() =>
              void run("workspace.focus", { workspaceId: ws.workspace_id })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void run("workspace.focus", { workspaceId: ws.workspace_id });
              }
            }}
            className={cn(
              "group flex items-center gap-2 rounded-md px-2 py-1 text-xs cursor-pointer transition-colors",
              ws.focused
                ? "bg-accent-brand/15 text-foreground font-medium"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <span
              className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[10px] font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {spaceInitial(label)}
            </span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {ws.tab_count > 1 && (
              <span className="shrink-0 rounded bg-muted/70 px-1 text-[10px] text-muted-foreground group-hover:hidden">
                {ws.tab_count}
              </span>
            )}
            <SpaceStatusDot status={ws.agent_status} />
            <div className="hidden items-center gap-0.5 group-hover:flex">
              <button
                type="button"
                title={t("navigator.newWorktree")}
                aria-label={t("navigator.newWorktree")}
                onClick={(e) => {
                  e.stopPropagation();
                  setWorktreeForWs((cur) =>
                    cur === ws.workspace_id ? null : ws.workspace_id,
                  );
                  setWtBranch("");
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <GitBranch className="size-3" />
              </button>
              <button
                type="button"
                title={t("navigator.rename")}
                aria-label={t("navigator.rename")}
                onClick={(e) => {
                  e.stopPropagation();
                  setRenameDraft(label);
                  setRenamingSpaceId(ws.workspace_id);
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Pencil className="size-3" />
              </button>
              <button
                type="button"
                title={t("navigator.closeWorkspace")}
                aria-label={t("navigator.closeWorkspace")}
                onClick={(e) => {
                  e.stopPropagation();
                  void confirmCloseSpace(ws);
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </div>
          </div>
        )}

        {ws.worktree?.branch && (
          <div className="flex items-center gap-1.5 pl-6 pr-2 pb-0.5 text-[11px] text-muted-foreground">
            <span className="font-mono text-muted-foreground/60">└─</span>
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{ws.worktree.branch}</span>
          </div>
        )}

        {worktreeForWs === ws.workspace_id && (
          <form
            className="mx-2 my-1 flex flex-col gap-1.5 rounded border border-border bg-background p-2"
            onSubmit={(e) => {
              e.preventDefault();
              const branch = wtBranch.trim();
              if (!branch) return;
              setWorktreeForWs(null);
              setWtBranch("");
              void run("worktree.create", {
                workspaceId: ws.workspace_id,
                branch,
              });
            }}
          >
            <input
              autoFocus
              aria-label={t("navigator.worktreeBranch")}
              placeholder={t("navigator.worktreeBranchPlaceholder")}
              value={wtBranch}
              onChange={(e) => setWtBranch(e.target.value)}
              className="h-7 rounded border border-border bg-transparent px-2 text-xs"
            />
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => setWorktreeForWs(null)}
              >
                {t("navigator.cancel")}
              </Button>
              <Button size="sm" type="submit" disabled={!wtBranch.trim()}>
                {t("navigator.createWorktree")}
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <aside
      ref={sidebarRef}
      style={{ width: `${sidebarWidth}px` }}
      className="relative flex shrink-0 flex-col border-r border-border bg-background/50 select-none"
      data-testid="herdr-app-sidebar"
    >
      {/* Top chrome header */}
      <div className="flex h-9 items-center justify-between border-b border-border px-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Bot className="size-3.5 text-accent-brand" />
          <span>{t("tab.title")}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <ListRowAction
            label={t("chrome.search")}
            tone={searchOpen || Boolean(searchQuery) ? "brand" : "default"}
            onClick={() => {
              setSearchOpen((open) => {
                if (open) setSearchQuery("");
                return !open;
              });
            }}
          >
            <Search className="size-3.5" />
          </ListRowAction>
          <ListRowAction
            label={t("toolbar.sidebarCollapse")}
            onClick={() => onModeChange("rail")}
          >
            <PanelLeftClose className="size-3.5" />
          </ListRowAction>
        </div>
      </div>

      {/* Instant Filter / Quick Switcher bar */}
      {searchOpen && (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <Search className="size-3 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            aria-label={t("chrome.search")}
            placeholder={t("chrome.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                setSearchOpen(false);
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (filteredAgents[0]) {
                  void run("pane.focus", { paneId: filteredAgents[0].pane_id });
                  setSearchQuery("");
                  setSearchOpen(false);
                } else if (workspaces[0]) {
                  void run("workspace.focus", {
                    workspaceId: workspaces[0].workspace_id,
                  });
                  setSearchQuery("");
                  setSearchOpen(false);
                }
              }
            }}
            className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      )}

      {/* Split body: Spaces (top) + Resizable Divider + Agents (bottom) */}
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        {/* Upper half: Spaces */}
        <div
          style={{ flex: `${splitRatio} 1 0%` }}
          className="flex min-h-0 flex-col overflow-y-auto px-1.5 py-2"
        >
          <div className="mb-1 flex items-center justify-between px-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("chrome.spaces")}
            </span>
            <div className="flex items-center gap-0.5">
              <ListRowAction
                label={t("navigator.newWorkspaceWithOptions")}
                onClick={() => setCreatingSpace((open) => !open)}
              >
                <FolderPlus className="size-3.5" />
              </ListRowAction>
              <ListRowAction
                label={t("chrome.newSpace")}
                onClick={() => void run("workspace.create")}
              >
                <Plus className="size-3.5" />
              </ListRowAction>
            </div>
          </div>

          {creatingSpace && (
            <form
              className="mb-2 flex flex-col gap-1.5 rounded border border-border bg-background p-2"
              onSubmit={(e) => {
                e.preventDefault();
                const label = spaceName.trim();
                const cwd = spaceCwd.trim();
                setCreatingSpace(false);
                setSpaceName("");
                setSpaceCwd("");
                void run("workspace.create", {
                  ...(label ? { label } : {}),
                  ...(cwd ? { cwd } : {}),
                });
              }}
            >
              <input
                autoFocus
                aria-label={t("navigator.workspaceLabel")}
                placeholder={t("navigator.workspaceLabelPlaceholder")}
                value={spaceName}
                onChange={(e) => setSpaceName(e.target.value)}
                className="h-7 rounded border border-border bg-transparent px-2 text-xs"
              />
              <input
                aria-label={t("navigator.workspaceCwd")}
                placeholder={t("navigator.workspaceCwdPlaceholder")}
                value={spaceCwd}
                onChange={(e) => setSpaceCwd(e.target.value)}
                className="h-7 rounded border border-border bg-transparent px-2 text-xs"
              />
              <div className="flex justify-end gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setCreatingSpace(false)}
                >
                  {t("navigator.cancel")}
                </Button>
                <Button size="sm" type="submit">
                  {t("navigator.create")}
                </Button>
              </div>
            </form>
          )}

          {showMachineHeaders && localSpaces.length > 0 && (
            <div className="mt-1 mb-0.5 flex items-center gap-1.5 px-2 text-[11px] font-medium text-muted-foreground">
              <Monitor className="size-3" />
              <span className="truncate">{t("chrome.thisComputer")}</span>
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            {localSpaces.map((ws, idx) => renderSpaceRow(ws, idx))}
          </div>

          {[...remoteMachineNames].map((machineName) => {
            const info = machineInfoMap.get(machineName);
            const connected = !info?.state || info.state === "connected";
            const machineSpaces = workspaces.filter(
              (w) => w.machine === machineName,
            );
            return (
              <div key={machineName} className="mt-2.5 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <Server className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{machineName}</span>
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      connected ? "bg-emerald-400" : "bg-muted-foreground/40",
                    )}
                    title={info?.state ?? "connected"}
                  />
                </div>
                {machineSpaces.map((ws, idx) =>
                  renderSpaceRow(ws, localSpaces.length + idx),
                )}
              </div>
            );
          })}

          {normalizedFilter && workspaces.length === 0 && (
            <div className="px-2 py-2 text-center text-xs text-muted-foreground">
              {t("chrome.noMatches")}
            </div>
          )}
        </div>

        {/* Horizontal drag handle between Spaces and Agents */}
        <div
          role="separator"
          aria-orientation="horizontal"
          title={t("chrome.resizeSplit")}
          data-testid="herdr-sidebar-split-handle"
          onMouseDown={startVerticalSplitResize}
          onDoubleClick={() => setSplitRatio(DEFAULT_SPLIT_RATIO)}
          className={cn(
            "h-1.5 shrink-0 cursor-row-resize border-t border-border transition-colors hover:bg-accent-brand/50",
            draggingSplit && "bg-accent-brand/70",
          )}
        />

        {/* Lower half: Agents */}
        <div
          style={{ flex: `${1 - splitRatio} 1 0%` }}
          className="flex min-h-0 flex-col overflow-y-auto px-1.5 py-2"
        >
          <div className="mb-1 flex items-center justify-between px-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("chrome.agents")}
            </span>
            <button
              type="button"
              title={t("chrome.sortToggleHint")}
              onClick={() =>
                onAgentSortChange(
                  agentSort === "priority" ? "grouped" : "priority",
                )
              }
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowUpDown className="size-2.5" />
              <span>
                {agentSort === "priority"
                  ? t("chrome.sortPriority")
                  : t("chrome.sortGrouped")}
              </span>
            </button>
          </div>

          {agentSections.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              {normalizedFilter ? t("chrome.noMatches") : t("chrome.noAgents")}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {agentSections.map((section) => (
                <div key={section.title} className="flex flex-col gap-0.5">
                  <div className="px-2 text-[10px] font-medium text-muted-foreground/80">
                    {section.title}
                  </div>
                  {section.items.map((agent) => {
                    const ws = workspaceById.get(agent.workspace_id);
                    const spaceLabel = ws
                      ? displaySpaceLabel(ws)
                      : agent.workspace_id;
                    const detail =
                      agent.status_msg ||
                      (agent.foreground_cwd ?? agent.cwd ?? "")
                        .split("/")
                        .filter(Boolean)
                        .pop() ||
                      "";
                    const subAgents =
                      childrenByParent.get(
                        agent.terminal_id ?? agent.pane_id,
                      ) ?? [];

                    return (
                      <div key={agent.pane_id} className="flex flex-col">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            void run("pane.focus", { paneId: agent.pane_id })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void run("pane.focus", { paneId: agent.pane_id });
                            }
                          }}
                          className={cn(
                            "group flex flex-col gap-0.5 rounded-md px-2 py-1 text-xs cursor-pointer transition-colors",
                            agent.focused
                              ? "bg-accent-brand/15 text-foreground"
                              : "hover:bg-muted/60",
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                              {paneTitle(agent)}
                            </span>
                            <div className="hidden items-center gap-0.5 group-hover:flex">
                              <button
                                type="button"
                                title={t(
                                  agent.pinned
                                    ? "navigator.unpinAgent"
                                    : "navigator.pinAgent",
                                )}
                                aria-label={t(
                                  agent.pinned
                                    ? "navigator.unpinAgent"
                                    : "navigator.pinAgent",
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void run("agent.pin", {
                                    paneId: agent.pane_id,
                                    pinned: !agent.pinned,
                                  });
                                }}
                                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                {agent.pinned ? (
                                  <PinOff className="size-3" />
                                ) : (
                                  <Pin className="size-3" />
                                )}
                              </button>
                              <button
                                type="button"
                                title={t("navigator.interruptPane")}
                                aria-label={t("navigator.interruptPane")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void run("pane.interrupt", {
                                    paneId: agent.pane_id,
                                  });
                                }}
                                className="rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                              >
                                <OctagonX className="size-3" />
                              </button>
                            </div>
                            <StatusIndicator status={agent.agent_status} />
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <span className="truncate">
                              {detail
                                ? `${spaceLabel} · ${detail}`
                                : spaceLabel}
                            </span>
                            {agent.machine && (
                              <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[10px]">
                                {agent.machine}
                              </span>
                            )}
                          </div>
                        </div>

                        {agent.agent_status === "blocked" && (
                          <div className="flex flex-wrap items-center gap-1 px-2 py-1">
                            {QUICK_APPROVAL_KEYS.map((item) => (
                              <button
                                key={item.label}
                                type="button"
                                onClick={() =>
                                  void run("pane.sendKeys", {
                                    paneId: agent.pane_id,
                                    keys: item.keys,
                                  })
                                }
                                className="h-5 rounded border border-border bg-background px-1.5 text-[10px] hover:bg-muted"
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        )}

                        {subAgents.map((sub, idx) => (
                          <button
                            key={sub.pane_id}
                            type="button"
                            onClick={() =>
                              void run("pane.focus", { paneId: sub.pane_id })
                            }
                            className="flex items-center gap-1.5 rounded px-2 py-0.5 pl-4 text-left text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                          >
                            <span className="font-mono text-muted-foreground/60">
                              {idx === subAgents.length - 1 ? "└" : "├"}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {paneTitle(sub)}
                            </span>
                            <StatusIndicator status={sub.agent_status} />
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right-edge mouse resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        title={t("chrome.resizeSidebar")}
        data-testid="herdr-sidebar-resize-handle"
        onMouseDown={startHorizontalResize}
        onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
        className={cn(
          "absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-accent-brand/50",
          draggingWidth && "bg-accent-brand/70",
        )}
      />
    </aside>
  );
}
