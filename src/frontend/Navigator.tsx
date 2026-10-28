import { useState, type ReactNode } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
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
  Bot,
  Check,
  Maximize2,
  Pencil,
  Plus,
  SquareSplitHorizontal,
  SquareSplitVertical,
  X,
} from "lucide-react";
import type {
  AgentStatus,
  HerdrLayout,
  HerdrPane,
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
}

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
}: {
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
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
}: {
  layout: HerdrLayout;
  panes: Map<string, HerdrPane>;
  run: RunAction;
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
            onClick={() => void run("pane.focus", { paneId: pane_id })}
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
 * Everything in herdr as plain lists: workspaces, tabs, a map of the current
 * tab's panes, agents waiting on you, and a text box that types into a pane
 * through herdr's API, where phone keyboards and dictation behave.
 */
export function Navigator({ snapshot, run }: NavigatorProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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

  async function closeWithConfirm(
    action: "workspace.close" | "tab.close" | "pane.close",
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
    if (ok) setDraft("");
  }

  return (
    <div className="flex flex-col gap-4 p-2.5" data-testid="herdr-navigator">
      {attention.length > 0 && (
        <Section title={t("navigator.attention")}>
          {attention.map((agent) => (
            <ListRow
              key={agent.pane_id}
              icon={<Bot className="size-4" />}
              title={paneName(agent, agent.pane_id)}
              meta={workspaceLabel.get(agent.workspace_id)}
              tone={agent.agent_status === "blocked" ? "warning" : "success"}
              badges={<StatusBadge status={agent.agent_status} />}
              onClick={() => void run("pane.focus", { paneId: agent.pane_id })}
            />
          ))}
        </Section>
      )}

      <Section
        title={t("navigator.workspaces")}
        action={
          <ListRowAction
            label={t("navigator.newWorkspace")}
            onClick={() => void run("workspace.create")}
          >
            <Plus className="size-3.5" />
          </ListRowAction>
        }
      >
        {workspaces.map((ws) => {
          const tabs = snapshot.tabs
            .filter((tab) => tab.workspace_id === ws.workspace_id)
            .sort((a, b) => a.number - b.number);
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
                  meta={t("navigator.tabCount", { count: ws.tab_count })}
                  selected={ws.focused}
                  tone={ws.focused ? "brand" : "none"}
                  badges={<StatusBadge status={ws.agent_status} />}
                  onClick={() =>
                    void run("workspace.focus", {
                      workspaceId: ws.workspace_id,
                    })
                  }
                  actions={
                    <>
                      <ListRowAction
                        label={t("navigator.rename")}
                        onClick={(event) => {
                          event.stopPropagation();
                          setRenaming(ws.workspace_id);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </ListRowAction>
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
                        onClick={() =>
                          void run("tab.focus", { tabId: tab.tab_id })
                        }
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
              <div className="flex gap-1">
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
          <PaneMap layout={layout} panes={panes} run={run} />
        </Section>
      )}

      {focusedPane && (
        <Section
          title={t("navigator.sendTo", {
            name: paneName(focusedPane, focusedPane.pane_id),
          })}
        >
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
            {focusedPane.agent && (
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
              variant={focusedPane.agent ? "outline" : "default"}
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
          </div>
        </Section>
      )}
    </div>
  );
}
