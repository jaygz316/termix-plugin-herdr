import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  GroupHeading,
  ListBadge,
  ListRow,
  ListRowAction,
  Textarea,
  cn,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderPlus,
  GitBranch,
  Maximize2,
  Pencil,
  Plus,
  RotateCw,
  SquareSplitHorizontal,
  SquareSplitVertical,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import type {
  AgentKind,
  AgentStatus,
  HerdrLayout,
  HerdrPane,
  HerdrSessionInfo,
  HerdrSnapshot,
} from "../shared/herdr";
import type { ActionName } from "./api";

export type RunAction = (
  action: ActionName,
  params?: Record<string, unknown>,
) => Promise<boolean>;

interface NavigatorProps {
  snapshot: HerdrSnapshot;
  run: RunAction;
  readPane?: (paneId: string, lines?: number) => Promise<string>;
  sessions?: HerdrSessionInfo[];
  activeSession?: string;
  onSelectSession?: (session: string) => void;
  onCloseNavigator?: () => void;
}

const QUICK_AGENT_KINDS: AgentKind[] = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "copilot",
  "cursor",
  "pi",
];

const APPROVAL_KEYS: Array<{ label: string; keys: string[] }> = [
  { label: "Enter", keys: ["enter"] },
  { label: "y", keys: ["y", "enter"] },
  { label: "n", keys: ["n", "enter"] },
  { label: "Esc", keys: ["esc"] },
  { label: "1", keys: ["1"] },
  { label: "2", keys: ["2"] },
  { label: "3", keys: ["3"] },
  { label: "↑", keys: ["up"] },
  { label: "↓", keys: ["down"] },
  { label: "^C", keys: ["ctrl+c"] },
];

const STATUS_TONE: Record<
  AgentStatus,
  "brand" | "warning" | "success" | "muted"
> = {
  working: "brand",
  blocked: "warning",
  done: "success",
  idle: "muted",
  unknown: "muted",
};

function StatusBadge({ status }: { status: AgentStatus | undefined }) {
  const { t } = useTranslation();
  if (!status || status === "unknown") return null;
  return (
    <ListBadge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</ListBadge>
  );
}

function paneName(pane: HerdrPane | undefined, fallback: string): string {
  if (!pane) return fallback;
  if (pane.label) return pane.label;
  if (pane.agent) return pane.agent;
  if (pane.terminal_title_stripped) return pane.terminal_title_stripped;
  const cwd = pane.foreground_cwd ?? pane.cwd;
  return cwd ? (cwd.split("/").filter(Boolean).pop() ?? cwd) : fallback;
}

/** An inline text box that replaces a row title while renaming. */
function RenameField({
  initial,
  onSave,
  onCancel,
  onClear,
}: {
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSave(value.trim());
      }}
    >
      <input
        autoFocus
        aria-label={t("navigator.newName")}
        className="h-8 min-w-0 flex-1 border border-border bg-transparent px-2 text-sm"
        value={value}
        maxLength={64}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
      />
      <ListRowAction label={t("navigator.save")} type="submit">
        <Check className="size-3.5" />
      </ListRowAction>
      {onClear && (
        <ListRowAction
          label={t("navigator.clearName")}
          type="button"
          onClick={onClear}
        >
          <Trash2 className="size-3.5" />
        </ListRowAction>
      )}
      <ListRowAction
        label={t("navigator.cancel")}
        type="button"
        onClick={onCancel}
      >
        <X className="size-3.5" />
      </ListRowAction>
    </form>
  );
}

/** The focused tab's panes, drawn to scale. Tap one to focus it. */
function PaneMap({
  layout,
  panes,
  run,
  onCloseNavigator,
}: {
  layout: HerdrLayout;
  panes: Map<string, HerdrPane>;
  run: RunAction;
  onCloseNavigator?: () => void;
}) {
  const { t } = useTranslation();
  const { area } = layout;
  // Terminal cells are about twice as tall as they are wide. A phone-sized
  // herdr is taller than wide; keep the map short so the text box below
  // stays on screen. It is a map, not a picture.
  const aspect = area.width / Math.max(area.height * 2, 1);
  return (
    <div
      className="relative w-full border border-border"
      style={{ aspectRatio: `${Math.min(Math.max(aspect, 1.6), 3)}` }}
      data-testid="herdr-pane-map"
    >
      {layout.panes.map(({ pane_id, rect, focused }) => {
        const pane = panes.get(pane_id);
        return (
          <button
            key={pane_id}
            type="button"
            onClick={() => {
              if (focused && onCloseNavigator) {
                onCloseNavigator();
                return;
              }
              void run("pane.focus", { paneId: pane_id });
            }}
            className={cn(
              "absolute flex flex-col items-start justify-start gap-0.5 overflow-hidden border p-1 text-left text-[11px]",
              focused
                ? "border-accent-brand bg-accent-brand/10"
                : "border-border bg-background active:bg-muted",
            )}
            style={{
              left: `${((rect.x - area.x) / area.width) * 100}%`,
              top: `${((rect.y - area.y) / area.height) * 100}%`,
              width: `${(rect.width / area.width) * 100}%`,
              height: `${(rect.height / area.height) * 100}%`,
            }}
            aria-label={t("navigator.focusPane", {
              name: paneName(pane, pane_id),
            })}
          >
            <span className="w-full truncate font-medium">
              {paneName(pane, pane_id)}
            </span>
            {pane?.agent && <StatusBadge status={pane.agent_status} />}
          </button>
        );
      })}
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <GroupHeading title={title} action={action} />
      {children}
    </section>
  );
}

/**
 * Everything in herdr as plain lists: workspaces, worktrees, tabs, a map of
 * the current tab's panes, agents waiting on you, a live pane output preview,
 * and a text box that types into a pane through herdr's API, where phone
 * keyboards and dictation behave.
 */
export function Navigator({
  snapshot,
  run,
  readPane,
  sessions,
  activeSession,
  onSelectSession,
  onCloseNavigator,
}: NavigatorProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Workspace creation with optional label + cwd
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [wsLabel, setWsLabel] = useState("");
  const [wsCwd, setWsCwd] = useState("");

  // Git worktree creation for a workspace
  const [worktreeForWs, setWorktreeForWs] = useState<string | null>(null);
  const [wtBranch, setWtBranch] = useState("");
  const [wtLabel, setWtLabel] = useState("");

  // Custom session input
  const [editingSession, setEditingSession] = useState(false);
  const [sessionInput, setSessionInput] = useState("");

  // Collapsible live output preview for focused pane
  const [outputOpen, setOutputOpen] = useState(true);
  const [outputText, setOutputText] = useState<string>("");
  const [outputLoading, setOutputLoading] = useState(false);

  const panes = new Map(snapshot.panes.map((pane) => [pane.pane_id, pane]));
  const focusedPane = snapshot.focused_pane_id
    ? panes.get(snapshot.focused_pane_id)
    : undefined;
  const layout = snapshot.layouts.find(
    (entry) => entry.tab_id === snapshot.focused_tab_id,
  );
  const workspaceLabel = new Map(
    snapshot.workspaces.map((ws) => [ws.workspace_id, ws.label]),
  );
  const attention = snapshot.agents.filter(
    (agent) =>
      agent.agent_status === "blocked" || agent.agent_status === "done",
  );
  const workspaces = [...snapshot.workspaces].sort(
    (a, b) => a.number - b.number,
  );

  const refreshOutput = useCallback(async () => {
    if (!readPane || !focusedPane) return;
    setOutputLoading(true);
    try {
      const text = await readPane(focusedPane.pane_id, 80);
      setOutputText(text);
    } catch {
      // Keep the previous output if a background read fails.
    } finally {
      setOutputLoading(false);
    }
  }, [readPane, focusedPane]);

  useEffect(() => {
    if (!readPane || !focusedPane || !outputOpen) return;
    void refreshOutput();
  }, [
    readPane,
    focusedPane?.pane_id,
    focusedPane?.agent_status,
    outputOpen,
    refreshOutput,
  ]);

  async function copyOutput() {
    if (!outputText) return;
    try {
      await navigator.clipboard?.writeText(outputText);
      toast.success(t("navigator.outputCopied"));
    } catch {
      toast.error(t("navigator.outputCopyFailed"));
    }
  }

  async function closeWithConfirm(
    action: "workspace.close" | "tab.close" | "pane.close" | "worktree.remove",
    params: Record<string, unknown>,
    name: string,
  ) {
    const ok = await confirm({
      title: t(`navigator.confirm.${action}`, { name }),
      description: t("navigator.confirm.description"),
      confirmLabel: t("navigator.close"),
      destructive: true,
    });
    if (ok) await run(action, params);
  }

  async function send(kind: "prompt" | "text" | "run") {
    if (!focusedPane || !draft) return;
    const ok =
      kind === "prompt"
        ? await run("agent.prompt", {
            paneId: focusedPane.pane_id,
            text: draft,
          })
        : kind === "run"
          ? await run("pane.run", {
              paneId: focusedPane.pane_id,
              command: draft,
            })
          : await run("pane.sendText", {
              paneId: focusedPane.pane_id,
              text: draft,
            });
    if (ok) {
      setDraft("");
      void refreshOutput();
    }
  }

  async function sendQuickKeys(paneId: string, keys: string[]) {
    const ok = await run("pane.sendKeys", { paneId, keys });
    if (ok) void refreshOutput();
  }

  const nextSwapPaneId =
    layout && layout.panes.length > 1 && focusedPane
      ? layout.panes[
          (layout.panes.findIndex((p) => p.pane_id === focusedPane.pane_id) +
            1) %
            layout.panes.length
        ]?.pane_id
      : undefined;

  const isFocusedBlocked = focusedPane?.agent_status === "blocked";

  return (
    <div className="flex flex-col gap-4 p-2.5" data-testid="herdr-navigator">
      {(onSelectSession || onCloseNavigator) && (
        <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border pb-2">
          {onSelectSession && (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              <span className="text-xs text-muted-foreground">
                {t("navigator.session")}:
              </span>
              {(sessions && sessions.length > 0
                ? sessions
                : [{ name: activeSession || "default" }]
              ).map((entry) => {
                const isCurrent =
                  (activeSession || "default") === (entry.name || "default");
                return (
                  <button
                    key={entry.name}
                    type="button"
                    onClick={() =>
                      onSelectSession(
                        entry.name === "default" ? "" : entry.name,
                      )
                    }
                    className={cn(
                      "h-6 border px-1.5 text-xs",
                      isCurrent
                        ? "border-accent-brand text-accent-brand"
                        : "border-border text-foreground active:bg-muted",
                    )}
                  >
                    {entry.name}
                  </button>
                );
              })}
              {editingSession ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const trimmed = sessionInput.trim();
                    setEditingSession(false);
                    setSessionInput("");
                    onSelectSession(trimmed === "default" ? "" : trimmed);
                  }}
                >
                  <input
                    autoFocus
                    aria-label={t("navigator.sessionName")}
                    placeholder="default"
                    className="h-6 w-24 border border-border bg-transparent px-1.5 text-xs"
                    value={sessionInput}
                    maxLength={64}
                    onChange={(event) => setSessionInput(event.target.value)}
                    onKeyDown={(event) =>
                      event.key === "Escape" && setEditingSession(false)
                    }
                  />
                  <ListRowAction label={t("navigator.save")} type="submit">
                    <Check className="size-3" />
                  </ListRowAction>
                </form>
              ) : (
                <ListRowAction
                  label={t("navigator.switchSession")}
                  onClick={() => {
                    setSessionInput(activeSession || "");
                    setEditingSession(true);
                  }}
                >
                  <Pencil className="size-3" />
                </ListRowAction>
              )}
            </div>
          )}
          {onCloseNavigator && (
            <Button size="sm" variant="outline" onClick={onCloseNavigator}>
              <TerminalSquare className="mr-1 size-3.5" />
              {t("navigator.showTerminal")}
            </Button>
          )}
        </div>
      )}

      {attention.length > 0 && (
        <Section title={t("navigator.attention")}>
          {attention.map((agent) => (
            <div key={agent.pane_id} className="flex flex-col gap-1">
              <ListRow
                icon={<Bot className="size-4" />}
                title={paneName(agent, agent.pane_id)}
                meta={workspaceLabel.get(agent.workspace_id)}
                tone={agent.agent_status === "blocked" ? "warning" : "success"}
                badges={<StatusBadge status={agent.agent_status} />}
                onClick={() => {
                  if (agent.focused && onCloseNavigator) {
                    onCloseNavigator();
                    return;
                  }
                  void run("pane.focus", { paneId: agent.pane_id });
                }}
              />
              {agent.agent_status === "blocked" && (
                <div
                  className="flex flex-wrap items-center gap-1 pl-6"
                  data-testid={`herdr-quick-keys-${agent.pane_id}`}
                >
                  {APPROVAL_KEYS.slice(0, 6).map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      aria-label={t("navigator.sendKey", {
                        key: item.label,
                        name: paneName(agent, agent.pane_id),
                      })}
                      onClick={() =>
                        void sendQuickKeys(agent.pane_id, item.keys)
                      }
                      className="h-6 border border-border bg-background px-1.5 text-[11px] active:bg-muted"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      <Section
        title={t("navigator.workspaces")}
        action={
          <div className="flex gap-1">
            <ListRowAction
              label={t("navigator.newWorkspaceWithOptions")}
              onClick={() => setCreatingWorkspace((open) => !open)}
            >
              <FolderPlus className="size-3.5" />
            </ListRowAction>
            <ListRowAction
              label={t("navigator.newWorkspace")}
              onClick={() => void run("workspace.create")}
            >
              <Plus className="size-3.5" />
            </ListRowAction>
          </div>
        }
      >
        {creatingWorkspace && (
          <form
            className="flex flex-col gap-1.5 border border-border p-2"
            data-testid="herdr-new-workspace-form"
            onSubmit={(event) => {
              event.preventDefault();
              const label = wsLabel.trim();
              const cwd = wsCwd.trim();
              setCreatingWorkspace(false);
              setWsLabel("");
              setWsCwd("");
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
              className="h-8 border border-border bg-transparent px-2 text-xs"
              value={wsLabel}
              maxLength={64}
              onChange={(event) => setWsLabel(event.target.value)}
            />
            <input
              aria-label={t("navigator.workspaceCwd")}
              placeholder={t("navigator.workspaceCwdPlaceholder")}
              className="h-8 border border-border bg-transparent px-2 text-xs"
              value={wsCwd}
              maxLength={512}
              onChange={(event) => setWsCwd(event.target.value)}
            />
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => setCreatingWorkspace(false)}
              >
                {t("navigator.cancel")}
              </Button>
              <Button size="sm" type="submit">
                {t("navigator.create")}
              </Button>
            </div>
          </form>
        )}

        {workspaces.map((ws) => {
          const tabs = snapshot.tabs
            .filter((tab) => tab.workspace_id === ws.workspace_id)
            .sort((a, b) => a.number - b.number);
          const isWorktree = Boolean(ws.worktree?.branch || ws.worktree?.path);
          return (
            <div key={ws.workspace_id} className="flex flex-col">
              {renaming === ws.workspace_id ? (
                <RenameField
                  initial={ws.label}
                  onCancel={() => setRenaming(null)}
                  onSave={(label) => {
                    setRenaming(null);
                    void run("workspace.rename", {
                      workspaceId: ws.workspace_id,
                      label,
                    });
                  }}
                />
              ) : (
                <ListRow
                  title={`${ws.number}. ${ws.label}`}
                  meta={
                    ws.worktree?.branch
                      ? `${ws.worktree.branch} · ${t("navigator.tabCount", { count: ws.tab_count })}`
                      : t("navigator.tabCount", { count: ws.tab_count })
                  }
                  selected={ws.focused}
                  tone={ws.focused ? "brand" : "none"}
                  badges={<StatusBadge status={ws.agent_status} />}
                  onClick={() => {
                    if (ws.focused && onCloseNavigator) {
                      onCloseNavigator();
                      return;
                    }
                    void run("workspace.focus", {
                      workspaceId: ws.workspace_id,
                    });
                  }}
                  actions={
                    <>
                      <ListRowAction
                        label={t("navigator.newWorktree")}
                        onClick={(event) => {
                          event.stopPropagation();
                          setWorktreeForWs((cur) =>
                            cur === ws.workspace_id ? null : ws.workspace_id,
                          );
                          setWtBranch("");
                          setWtLabel("");
                        }}
                      >
                        <GitBranch className="size-3.5" />
                      </ListRowAction>
                      <ListRowAction
                        label={t("navigator.rename")}
                        onClick={(event) => {
                          event.stopPropagation();
                          setRenaming(ws.workspace_id);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </ListRowAction>
                      {isWorktree && (
                        <ListRowAction
                          label={t("navigator.removeWorktree")}
                          tone="destructive"
                          onClick={(event) => {
                            event.stopPropagation();
                            void closeWithConfirm(
                              "worktree.remove",
                              { workspaceId: ws.workspace_id },
                              ws.label,
                            );
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </ListRowAction>
                      )}
                      <ListRowAction
                        label={t("navigator.closeWorkspace")}
                        tone="destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          void closeWithConfirm(
                            "workspace.close",
                            { workspaceId: ws.workspace_id },
                            ws.label,
                          );
                        }}
                      >
                        <X className="size-3.5" />
                      </ListRowAction>
                    </>
                  }
                />
              )}

              {worktreeForWs === ws.workspace_id && (
                <form
                  className="ml-4 flex flex-col gap-1.5 border border-border p-2"
                  data-testid="herdr-new-worktree-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const branch = wtBranch.trim();
                    if (!branch) return;
                    const label = wtLabel.trim();
                    setWorktreeForWs(null);
                    setWtBranch("");
                    setWtLabel("");
                    void run("worktree.create", {
                      workspaceId: ws.workspace_id,
                      branch,
                      ...(label ? { label } : {}),
                    });
                  }}
                >
                  <input
                    autoFocus
                    aria-label={t("navigator.worktreeBranch")}
                    placeholder={t("navigator.worktreeBranchPlaceholder")}
                    className="h-8 border border-border bg-transparent px-2 text-xs"
                    value={wtBranch}
                    maxLength={128}
                    onChange={(event) => setWtBranch(event.target.value)}
                  />
                  <input
                    aria-label={t("navigator.workspaceLabel")}
                    placeholder={t("navigator.workspaceLabelPlaceholder")}
                    className="h-8 border border-border bg-transparent px-2 text-xs"
                    value={wtLabel}
                    maxLength={64}
                    onChange={(event) => setWtLabel(event.target.value)}
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

              {ws.focused && (
                <div className="ml-4 flex flex-col border-l border-border pl-2">
                  {tabs.map((tab) =>
                    renaming === tab.tab_id ? (
                      <RenameField
                        key={tab.tab_id}
                        initial={tab.label}
                        onCancel={() => setRenaming(null)}
                        onSave={(label) => {
                          setRenaming(null);
                          void run("tab.rename", { tabId: tab.tab_id, label });
                        }}
                      />
                    ) : (
                      <ListRow
                        key={tab.tab_id}
                        title={
                          // herdr labels new tabs with their number.
                          tab.label === String(tab.number)
                            ? t("navigator.tabNumber", { number: tab.number })
                            : t("navigator.tabTitle", {
                                number: tab.number,
                                label: tab.label,
                              })
                        }
                        meta={t("navigator.paneCount", {
                          count: tab.pane_count,
                        })}
                        selected={tab.focused}
                        badges={<StatusBadge status={tab.agent_status} />}
                        onClick={() => {
                          if (tab.focused && onCloseNavigator) {
                            onCloseNavigator();
                            return;
                          }
                          void run("tab.focus", { tabId: tab.tab_id });
                        }}
                        actions={
                          <>
                            <ListRowAction
                              label={t("navigator.rename")}
                              onClick={(event) => {
                                event.stopPropagation();
                                setRenaming(tab.tab_id);
                              }}
                            >
                              <Pencil className="size-3.5" />
                            </ListRowAction>
                            <ListRowAction
                              label={t("navigator.closeTab")}
                              tone="destructive"
                              onClick={(event) => {
                                event.stopPropagation();
                                void closeWithConfirm(
                                  "tab.close",
                                  { tabId: tab.tab_id },
                                  tab.label,
                                );
                              }}
                            >
                              <X className="size-3.5" />
                            </ListRowAction>
                          </>
                        }
                      />
                    ),
                  )}
                  <button
                    type="button"
                    className="flex h-8 items-center gap-1 px-2 text-xs text-muted-foreground active:bg-muted"
                    onClick={() =>
                      void run("tab.create", { workspaceId: ws.workspace_id })
                    }
                  >
                    <Plus className="size-3.5" />
                    {t("actions.newTab")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </Section>

      {layout && (
        <Section
          title={t("navigator.panes")}
          action={
            focusedPane && (
              <div className="flex flex-wrap gap-1">
                <ListRowAction
                  label={t("navigator.renamePane")}
                  onClick={() =>
                    setRenaming((cur) =>
                      cur === focusedPane.pane_id ? null : focusedPane.pane_id,
                    )
                  }
                >
                  <Pencil className="size-3.5" />
                </ListRowAction>
                <ListRowAction
                  label={t("actions.splitRight")}
                  onClick={() =>
                    void run("pane.split", {
                      paneId: focusedPane.pane_id,
                      direction: "right",
                    })
                  }
                >
                  <SquareSplitHorizontal className="size-3.5" />
                </ListRowAction>
                <ListRowAction
                  label={t("actions.splitDown")}
                  onClick={() =>
                    void run("pane.split", {
                      paneId: focusedPane.pane_id,
                      direction: "down",
                    })
                  }
                >
                  <SquareSplitVertical className="size-3.5" />
                </ListRowAction>
                {nextSwapPaneId && (
                  <ListRowAction
                    label={t("navigator.swapPane")}
                    onClick={() =>
                      void run("pane.swap", {
                        paneId: focusedPane.pane_id,
                        targetPaneId: nextSwapPaneId,
                      })
                    }
                  >
                    <ArrowLeftRight className="size-3.5" />
                  </ListRowAction>
                )}
                <ListRowAction
                  label={t("actions.zoom")}
                  onClick={() =>
                    void run("pane.zoom", { paneId: focusedPane.pane_id })
                  }
                >
                  <Maximize2 className="size-3.5" />
                </ListRowAction>
                <ListRowAction
                  label={t("navigator.closePane")}
                  tone="destructive"
                  onClick={() =>
                    void closeWithConfirm(
                      "pane.close",
                      { paneId: focusedPane.pane_id },
                      paneName(focusedPane, focusedPane.pane_id),
                    )
                  }
                >
                  <X className="size-3.5" />
                </ListRowAction>
              </div>
            )
          }
        >
          {focusedPane && renaming === focusedPane.pane_id && (
            <RenameField
              initial={
                focusedPane.label ?? paneName(focusedPane, focusedPane.pane_id)
              }
              onCancel={() => setRenaming(null)}
              onClear={
                focusedPane.label
                  ? () => {
                      setRenaming(null);
                      void run("pane.rename", {
                        paneId: focusedPane.pane_id,
                        clear: true,
                      });
                    }
                  : undefined
              }
              onSave={(label) => {
                setRenaming(null);
                void run("pane.rename", {
                  paneId: focusedPane.pane_id,
                  label,
                });
              }}
            />
          )}
          <PaneMap
            layout={layout}
            panes={panes}
            run={run}
            onCloseNavigator={onCloseNavigator}
          />
          {focusedPane && layout.panes.length > 1 && (
            <div className="flex items-center justify-between gap-1 pt-0.5">
              <span className="text-[11px] text-muted-foreground">
                {t("navigator.resizePane")}
              </span>
              <div className="flex gap-1">
                {(["left", "down", "up", "right"] as const).map((dir) => (
                  <ListRowAction
                    key={dir}
                    label={t(`navigator.resize.${dir}`)}
                    onClick={() =>
                      void run("pane.resize", {
                        paneId: focusedPane.pane_id,
                        direction: dir,
                      })
                    }
                  >
                    {dir === "left" && <ArrowLeft className="size-3.5" />}
                    {dir === "down" && <ArrowDown className="size-3.5" />}
                    {dir === "up" && <ArrowUp className="size-3.5" />}
                    {dir === "right" && <ArrowRight className="size-3.5" />}
                  </ListRowAction>
                ))}
              </div>
            </div>
          )}
          {focusedPane && !focusedPane.agent && (
            <div
              className="flex flex-wrap items-center gap-1 pt-1"
              data-testid="herdr-launch-agent"
            >
              <span className="text-[11px] text-muted-foreground">
                {t("navigator.launchAgent")}:
              </span>
              {QUICK_AGENT_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() =>
                    void run("agent.start", {
                      paneId: focusedPane.pane_id,
                      kind,
                    })
                  }
                  className="h-6 border border-border bg-background px-1.5 text-[11px] active:bg-muted"
                >
                  {kind}
                </button>
              ))}
            </div>
          )}
        </Section>
      )}

      {focusedPane && readPane && (
        <Section
          title={t("navigator.outputPreview", {
            name: paneName(focusedPane, focusedPane.pane_id),
          })}
          action={
            <div className="flex gap-1">
              {outputOpen && (
                <>
                  <ListRowAction
                    label={t("navigator.copyOutput")}
                    onClick={() => void copyOutput()}
                  >
                    <Copy className="size-3.5" />
                  </ListRowAction>
                  <ListRowAction
                    label={t("navigator.refreshOutput")}
                    onClick={() => void refreshOutput()}
                  >
                    <RotateCw
                      className={cn(
                        "size-3.5",
                        outputLoading && "animate-spin",
                      )}
                    />
                  </ListRowAction>
                </>
              )}
              <ListRowAction
                label={t(
                  outputOpen ? "navigator.hideOutput" : "navigator.showOutput",
                )}
                onClick={() => setOutputOpen((open) => !open)}
              >
                {outputOpen ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </ListRowAction>
            </div>
          }
        >
          {outputOpen && (
            <pre
              data-testid="herdr-pane-output"
              className="max-h-40 select-text overflow-auto whitespace-pre-wrap break-words border border-border bg-muted/30 p-2 font-mono text-[11px] leading-tight"
            >
              {outputText.trim() || t("navigator.emptyOutput")}
            </pre>
          )}
        </Section>
      )}

      {focusedPane && (
        <Section
          title={t("navigator.sendTo", {
            name: paneName(focusedPane, focusedPane.pane_id),
          })}
        >
          {isFocusedBlocked && (
            <div
              className="flex flex-col gap-1 border border-border p-1.5"
              data-testid="herdr-blocked-triage"
            >
              <span className="text-[11px] text-muted-foreground">
                {t("navigator.blockedHint")}
              </span>
              <div className="flex flex-wrap gap-1">
                {APPROVAL_KEYS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() =>
                      void sendQuickKeys(focusedPane.pane_id, item.keys)
                    }
                    className="h-7 border border-border bg-background px-2 text-xs active:bg-muted"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Textarea
            value={draft}
            rows={3}
            placeholder={t(
              focusedPane.agent
                ? "navigator.promptPlaceholder"
                : "navigator.textPlaceholder",
            )}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {focusedPane.agent && !isFocusedBlocked && (
              <Button
                size="sm"
                disabled={!draft}
                onClick={() => void send("prompt")}
              >
                {t("navigator.prompt")}
              </Button>
            )}
            <Button
              size="sm"
              variant={
                focusedPane.agent && !isFocusedBlocked ? "outline" : "default"
              }
              disabled={!draft}
              onClick={() => void send("run")}
            >
              {t("navigator.run")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!draft}
              onClick={() => void send("text")}
            >
              {t("navigator.type")}
            </Button>
            {focusedPane.agent && isFocusedBlocked && (
              <Button
                size="sm"
                variant="outline"
                disabled={!draft}
                onClick={() => void send("prompt")}
              >
                {t("navigator.prompt")}
              </Button>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
