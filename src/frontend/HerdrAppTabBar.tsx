import { useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { ListRowAction, cn, useConfirm } from "@termix-ssh/plugin-sdk/ui";
import {
  Bot,
  Check,
  FolderPlus,
  GitBranch,
  Maximize2,
  Monitor,
  OctagonX,
  PanelLeftOpen,
  Plus,
  Server,
  SquareSplitHorizontal,
  SquareSplitVertical,
  TerminalSquare,
  X,
} from "lucide-react";
import type {
  AgentKind,
  AgentStatus,
  HerdrPane,
  HerdrSessionInfo,
  HerdrSnapshot,
  HerdrTab,
} from "../shared/herdr";
import type { SidebarMode } from "./HerdrAppSidebar";
import type { RunAction } from "./Navigator";

const NEW_MENU_AGENTS: AgentKind[] = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "copilot",
  "cursor",
  "pi",
];

function shortenPath(path: string | undefined): string {
  if (!path) return "";
  return path.replace(/^\/home\/[^/]+/, "~").replace(/^\/Users\/[^/]+/, "~");
}

function paneDisplayName(pane: HerdrPane | undefined): string {
  if (!pane) return "shell";
  if (pane.label) return pane.label;
  if (pane.agent) return pane.agent;
  if (pane.terminal_title_stripped) return pane.terminal_title_stripped;
  const cwd = pane.foreground_cwd ?? pane.cwd;
  return cwd ? (cwd.split("/").filter(Boolean).pop() ?? cwd) : "shell";
}

function TabStatusDot({ status }: { status: AgentStatus }) {
  if (status === "blocked") {
    return <span className="size-1.5 shrink-0 rounded-full bg-amber-400" />;
  }
  if (status === "error") {
    return <span className="size-1.5 shrink-0 rounded-full bg-red-400" />;
  }
  if (status === "working") {
    return (
      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
    );
  }
  if (status === "done") {
    return <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />;
  }
  return null;
}

interface HerdrAppTabBarProps {
  snapshot: HerdrSnapshot;
  run: RunAction;
  sidebarMode: SidebarMode;
  onExpandSidebar: () => void;
}

/**
 * Top tab bar (`mods/tabs` + `mods/new-menu`) and focused pane header bar
 * (`mods/pane`) that sit directly above the terminal in `herdr-app` mode.
 */
export function HerdrAppTabBar({
  snapshot,
  run,
  sidebarMode,
  onExpandSidebar,
}: HerdrAppTabBarProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const activeWsId =
    snapshot.focused_workspace_id ?? snapshot.workspaces[0]?.workspace_id;
  const spaceTabs = snapshot.tabs
    .filter((tab) => tab.workspace_id === activeWsId)
    .sort((a, b) => a.number - b.number);

  const focusedTab =
    spaceTabs.find((tab) => tab.tab_id === snapshot.focused_tab_id) ??
    spaceTabs.find((tab) => tab.focused) ??
    spaceTabs[0];

  const focusedLayout = snapshot.layouts.find(
    (l) => l.tab_id === focusedTab?.tab_id,
  );
  const tabPanes = snapshot.panes.filter(
    (p) => p.tab_id === focusedTab?.tab_id,
  );
  const focusedPane =
    tabPanes.find((p) => p.pane_id === snapshot.focused_pane_id) ??
    tabPanes.find((p) => p.focused) ??
    tabPanes[0];

  async function confirmCloseTab(tab: HerdrTab) {
    const ok = await confirm({
      title: t("navigator.confirm.tab.close", { name: tab.label }),
      description: t("navigator.confirm.description"),
      confirmLabel: t("navigator.close"),
      destructive: true,
    });
    if (ok) {
      await run("tab.close", { tabId: tab.tab_id });
    }
  }

  async function confirmClosePane(pane: HerdrPane) {
    const ok = await confirm({
      title: t("navigator.confirm.pane.close", {
        name: paneDisplayName(pane),
      }),
      description: t("navigator.confirm.description"),
      confirmLabel: t("navigator.close"),
      destructive: true,
    });
    if (ok) {
      await run("pane.close", { paneId: pane.pane_id });
    }
  }

  const cwdText = shortenPath(
    focusedPane?.foreground_cwd ?? focusedPane?.cwd ?? undefined,
  );

  return (
    <div
      className="flex flex-col border-b border-border bg-background/70 select-none"
      data-testid="herdr-app-tabbar"
    >
      {/* Top tab strip */}
      <div className="relative flex h-9 items-center gap-1 overflow-x-auto px-2">
        {sidebarMode === "hidden" && (
          <ListRowAction
            label={t("toolbar.sidebarExpand")}
            onClick={onExpandSidebar}
          >
            <PanelLeftOpen className="size-3.5" />
          </ListRowAction>
        )}

        {spaceTabs.map((tab) => {
          const isFocused = tab.tab_id === focusedTab?.tab_id;
          const layout = snapshot.layouts.find((l) => l.tab_id === tab.tab_id);
          const hasAgent = snapshot.panes.some(
            (p) => p.tab_id === tab.tab_id && Boolean(p.agent),
          );

          if (renamingTabId === tab.tab_id) {
            return (
              <form
                key={tab.tab_id}
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = renameDraft.trim();
                  setRenamingTabId(null);
                  if (next) {
                    void run("tab.rename", { tabId: tab.tab_id, label: next });
                  }
                }}
              >
                <input
                  autoFocus
                  aria-label={t("navigator.newName")}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Escape" && setRenamingTabId(null)
                  }
                  className="h-6 w-28 rounded border border-border bg-transparent px-1.5 text-xs"
                />
                <ListRowAction label={t("navigator.save")} type="submit">
                  <Check className="size-3" />
                </ListRowAction>
              </form>
            );
          }

          return (
            <div
              key={tab.tab_id}
              role="tab"
              aria-selected={isFocused}
              tabIndex={0}
              onClick={() => void run("tab.focus", { tabId: tab.tab_id })}
              onDoubleClick={() => {
                setRenameDraft(tab.label);
                setRenamingTabId(tab.tab_id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void run("tab.focus", { tabId: tab.tab_id });
                }
              }}
              className={cn(
                "group flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs cursor-pointer transition-colors",
                isFocused
                  ? "border-accent-brand/50 bg-accent-brand/15 text-foreground font-medium"
                  : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {hasAgent ? (
                <Bot className="size-3 shrink-0 text-accent-brand" />
              ) : (
                <TerminalSquare className="size-3 shrink-0 opacity-70" />
              )}
              <span className="max-w-36 truncate">{tab.label}</span>
              {layout?.zoomed && (
                <span
                  className="rounded bg-accent-brand/20 px-1 text-[10px] font-bold text-accent-brand"
                  title={t("chrome.zoomed")}
                >
                  Z
                </span>
              )}
              <TabStatusDot status={tab.agent_status} />
              {spaceTabs.length > 1 && (
                <button
                  type="button"
                  title={t("navigator.closeTab")}
                  aria-label={t("navigator.closeTab")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void confirmCloseTab(tab);
                  }}
                  className={cn(
                    "rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive",
                    isFocused
                      ? "opacity-80 hover:opacity-100"
                      : "opacity-0 group-hover:opacity-80",
                  )}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* + New Menu button */}
        {activeWsId && (
          <div className="relative">
            <button
              type="button"
              title={t("chrome.newMenu")}
              aria-label={t("actions.newTab")}
              onClick={() => setNewMenuOpen((open) => !open)}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>

            {newMenuOpen && (
              <div
                className="fixed inset-0 z-30"
                onClick={() => setNewMenuOpen(false)}
              />
            )}
            {newMenuOpen && (
              <div
                className="absolute left-0 top-8 z-40 w-48 rounded-md border border-border bg-background p-1.5 shadow-lg"
                data-testid="herdr-new-menu"
              >
                <button
                  type="button"
                  onClick={() => {
                    setNewMenuOpen(false);
                    void run("tab.create", { workspaceId: activeWsId });
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <TerminalSquare className="size-3.5 text-muted-foreground" />
                  <span>{t("chrome.newTerminal")}</span>
                </button>

                <div className="my-1 h-px bg-border" />
                <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("chrome.startAgent")}
                </div>
                <div className="grid grid-cols-2 gap-0.5">
                  {NEW_MENU_AGENTS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => {
                        setNewMenuOpen(false);
                        void run("tab.create", {
                          workspaceId: activeWsId,
                          label: kind,
                          agent: kind,
                        });
                      }}
                      className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                    >
                      <Bot className="size-3 text-accent-brand" />
                      <span className="truncate">{kind}</span>
                    </button>
                  ))}
                </div>

                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  onClick={() => {
                    setNewMenuOpen(false);
                    void run("workspace.create");
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <FolderPlus className="size-3.5 text-muted-foreground" />
                  <span>{t("chrome.newSpace")}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Focused pane header bar (mirrors mods/pane/main.js) */}
      {focusedPane && (
        <div className="flex h-7 items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-2.5 text-[11px]">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* Multi-pane split switcher pills when tab has >1 split panes */}
            {tabPanes.length > 1 ? (
              <div className="flex items-center gap-1 overflow-x-auto">
                {tabPanes.map((pane, idx) => {
                  const isActive = pane.pane_id === focusedPane.pane_id;
                  return (
                    <button
                      key={pane.pane_id}
                      type="button"
                      onClick={() =>
                        void run("pane.focus", { paneId: pane.pane_id })
                      }
                      className={cn(
                        "flex h-5 items-center gap-1 rounded px-1.5 text-[11px] transition-colors",
                        isActive
                          ? "bg-accent-brand/20 text-foreground font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <span>
                        {idx + 1}: {paneDisplayName(pane)}
                      </span>
                      <TabStatusDot status={pane.agent_status} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="font-medium text-foreground">
                {paneDisplayName(focusedPane)}
              </span>
            )}

            {cwdText && (
              <span className="truncate font-mono text-muted-foreground">
                {cwdText}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              title={t("actions.splitRight")}
              onClick={() =>
                void run("pane.split", {
                  paneId: focusedPane.pane_id,
                  direction: "right",
                })
              }
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <SquareSplitHorizontal className="size-3" />
            </button>
            <button
              type="button"
              title={t("actions.splitDown")}
              onClick={() =>
                void run("pane.split", {
                  paneId: focusedPane.pane_id,
                  direction: "down",
                })
              }
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <SquareSplitVertical className="size-3" />
            </button>
            <button
              type="button"
              title={t("actions.zoom")}
              onClick={() =>
                void run("pane.zoom", { paneId: focusedPane.pane_id })
              }
              className={cn(
                "rounded p-1 hover:bg-muted",
                focusedLayout?.zoomed
                  ? "text-accent-brand"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Maximize2 className="size-3" />
            </button>
            <button
              type="button"
              title={t("navigator.interruptPane")}
              onClick={() =>
                void run("pane.interrupt", { paneId: focusedPane.pane_id })
              }
              className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            >
              <OctagonX className="size-3" />
            </button>
            {tabPanes.length > 1 && (
              <button
                type="button"
                title={t("navigator.closePane")}
                onClick={() => void confirmClosePane(focusedPane)}
                className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface HerdrAppStatusBarProps {
  snapshot: HerdrSnapshot;
  sessions: HerdrSessionInfo[];
  activeSession: string;
  onSelectSession: (session: string) => void;
}

/**
 * Bottom status bar mirroring `herdr-app` `mods/workspace-status/main.js`.
 */
export function HerdrAppStatusBar({
  snapshot,
  sessions,
  activeSession,
  onSelectSession,
}: HerdrAppStatusBarProps) {
  const { t } = useTranslation();

  const focusedWs =
    snapshot.workspaces.find(
      (w) => w.workspace_id === snapshot.focused_workspace_id,
    ) ?? snapshot.workspaces[0];
  const machineName = focusedWs?.machine || t("chrome.thisComputer");
  const isRemote = Boolean(focusedWs?.machine);
  const folder = shortenPath(focusedWs?.folder);
  const branch = focusedWs?.worktree?.branch;

  const totalAgents = snapshot.agents.length;
  const needsYouCount = snapshot.agents.filter(
    (a) => a.agent_status === "blocked" || a.agent_status === "error",
  ).length;

  return (
    <div
      className="flex h-6 shrink-0 items-center justify-between gap-2 border-t border-border bg-background/80 px-2.5 text-[11px] text-muted-foreground select-none"
      data-testid="herdr-app-statusbar"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex items-center gap-1 font-medium text-foreground/90">
          {isRemote ? (
            <Server className="size-3 text-accent-brand" />
          ) : (
            <Monitor className="size-3 text-muted-foreground" />
          )}
          <span className="truncate">{machineName}</span>
        </span>

        {folder && <span className="truncate font-mono">{folder}</span>}

        {branch && (
          <span className="flex items-center gap-1 truncate">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{branch}</span>
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {sessions.length > 1 && (
          <div className="flex items-center gap-1">
            {sessions.map((s) => {
              const current =
                (activeSession || "default") === (s.name || "default");
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() =>
                    onSelectSession(s.name === "default" ? "" : s.name)
                  }
                  className={cn(
                    "rounded px-1 text-[10px]",
                    current
                      ? "bg-accent-brand/20 text-accent-brand font-medium"
                      : "hover:bg-muted hover:text-foreground",
                  )}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}

        <span>
          {t("chrome.agentCount", { count: totalAgents })}
          {needsYouCount > 0 && (
            <span className="ml-1 font-medium text-amber-400">
              · {t("chrome.needsYouCount", { count: needsYouCount })}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
