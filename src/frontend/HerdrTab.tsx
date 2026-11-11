import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  useDocsUrl,
  usePluginApi,
  usePluginComponent,
  useSettings,
  useToast,
  useTranslation,
  type TabProps,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  EmptyState,
  ListBadge,
  ListRowAction,
  PanelShell,
  useConfirm,
  useIsMobile,
} from "@termix-ssh/plugin-sdk/ui";
import {
  Bot,
  Keyboard,
  ListTree,
  MousePointerClick,
  RotateCw,
  TerminalSquare,
} from "lucide-react";
import type {
  AgentStatus,
  HerdrRuntime,
  HerdrSessionInfo,
  HerdrSnapshot,
  HerdrState,
} from "../shared/herdr";
import {
  apiErrorMessage,
  apiHerdrCode,
  herdrApi,
  type ActionName,
} from "./api";
import { herdrLaunchCommand, herdrSessionName } from "./host-settings";
import { KeyBar, type KeyBarActions } from "./KeyBar";
import { Navigator } from "./Navigator";
import {
  MouseModeTracker,
  prefixBytes,
  readTerminalGrid,
} from "./terminal-input";
import { TouchMouseLayer } from "./TouchMouseLayer";

/** What the SSH Terminal plugin's "terminal.view" hands back. */
interface TerminalHandleLike {
  sendInput: (data: string) => void;
  subscribeOutput: (listener: (data: string) => void) => () => void;
  focus: () => void;
  getApplicationCursorKeysMode: () => boolean;
}

const POLL_OPEN_MS = 2500;
const POLL_CLOSED_MS = 8000;

function coarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object") {
    (ref as { current: T | null }).current = value;
  }
}

type HerdrFailure = Extract<HerdrState, { available: false }>;

/** The failure in a state, if it is one. */
function failureOf(state: HerdrState | null): HerdrFailure | null {
  return state && !state.available ? (state as HerdrFailure) : null;
}

function newInstanceId(): string {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function resolveFocusTerminalId(
  snapshot: HerdrSnapshot | null,
  action: ActionName,
  params?: Record<string, unknown>,
): string | null {
  if (!snapshot) return null;
  if (action === "pane.focus") {
    const paneId = typeof params?.paneId === "string" ? params.paneId : "";
    const pane =
      snapshot.panes.find((p) => p.pane_id === paneId) ??
      snapshot.agents.find((a) => a.pane_id === paneId);
    return pane?.terminal_id ?? (paneId || null);
  }
  if (action === "tab.focus") {
    const tabId = typeof params?.tabId === "string" ? params.tabId : "";
    const layout = snapshot.layouts.find((l) => l.tab_id === tabId);
    const pane =
      snapshot.panes.find((p) => p.pane_id === layout?.focused_pane_id) ??
      snapshot.panes.find((p) => p.tab_id === tabId);
    return pane?.terminal_id ?? null;
  }
  if (action === "workspace.focus") {
    const wsId =
      typeof params?.workspaceId === "string" ? params.workspaceId : "";
    const ws = snapshot.workspaces.find((w) => w.workspace_id === wsId);
    const pane =
      snapshot.panes.find((p) => p.tab_id === ws?.active_tab_id && p.focused) ??
      snapshot.panes.find((p) => p.workspace_id === wsId);
    return pane?.terminal_id ?? null;
  }
  return null;
}

/**
 * herdr on one host: the real herdr TUI in Termix's own SSH terminal, with a
 * touch layer that speaks mouse to it, a key bar, and a navigator driven by
 * herdr's API.
 */
export function HerdrTab({ tab, host, isVisible, handleRef }: TabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const isMobile = useIsMobile();
  const docs = useDocsUrl();
  const pluginApi = usePluginApi();
  const TerminalView = usePluginComponent("terminal.view");
  const { values: userSettings } = useSettings("user");

  const hostId = Number(host?.id);
  const [sessionOverride, setSessionOverride] = useState<string | undefined>(
    undefined,
  );
  const [sessions, setSessions] = useState<HerdrSessionInfo[]>([]);
  const [runtime, setRuntime] = useState<HerdrRuntime | undefined>(undefined);
  const [attachedTerminalId, setAttachedTerminalId] = useState<string | null>(
    null,
  );
  const runtimeRef = useRef<HerdrRuntime | undefined>(undefined);
  const attachedTerminalRef = useRef<string | null>(null);
  runtimeRef.current = runtime;
  attachedTerminalRef.current = attachedTerminalId;

  const configuredSession = herdrSessionName(host);
  const activeSession =
    sessionOverride !== undefined
      ? sessionOverride || "default"
      : configuredSession || "default";

  const api = useMemo(
    () => herdrApi(pluginApi, hostId, sessionOverride),
    [pluginApi, hostId, sessionOverride],
  );
  const launch = herdrLaunchCommand(host, sessionOverride, {
    runtime,
    terminalId: attachedTerminalId,
  });

  const touchSetting = String(userSettings.touchMouse ?? "auto");
  const keyBarSetting = String(userSettings.showKeyBar ?? "auto");
  const notifySetting = String(userSettings.agentNotifications ?? "all");
  const longPressMs = Number(userSettings.longPressMs ?? 450) || 450;
  const prefix = prefixBytes(userSettings.prefixKey);
  const touchDevice = coarsePointer();

  const [touchOn, setTouchOn] = useState(
    touchSetting === "on" || (touchSetting === "auto" && touchDevice),
  );
  const [keyBarOn, setKeyBarOn] = useState(
    keyBarSetting === "always" ||
      (keyBarSetting === "auto" && (touchDevice || isMobile)),
  );
  // Follow the settings once they load or change.
  useEffect(() => {
    setTouchOn(
      touchSetting === "on" || (touchSetting === "auto" && touchDevice),
    );
  }, [touchSetting, touchDevice]);
  useEffect(() => {
    setKeyBarOn(
      keyBarSetting === "always" ||
        (keyBarSetting === "auto" && (touchDevice || isMobile)),
    );
  }, [keyBarSetting, touchDevice, isMobile]);

  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [state, setState] = useState<HerdrState | null>(null);
  const snapshotRef = useRef<HerdrSnapshot | null>(null);
  const prevAgentStatusRef = useRef<Map<string, AgentStatus> | null>(null);
  snapshotRef.current =
    state && state.available
      ? (state as Extract<HerdrState, { available: true }>).snapshot
      : null;

  useEffect(() => {
    prevAgentStatusRef.current = null;
  }, [hostId, sessionOverride]);

  // The embedded terminal, its handle and whether herdr asked for the mouse.
  const [instanceId, setInstanceId] = useState(
    () => (tab.instanceId as string | undefined) ?? newInstanceId(),
  );
  const [handle, setHandle] = useState<TerminalHandleLike | null>(null);
  // A restored tab reattaches to a session where herdr already turned the
  // mouse on, and that output is not sent again.
  const tracker = useMemo(
    () => new MouseModeTracker(Boolean(tab.restoredSessionId)),
    // A new terminal session starts a fresh tracker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instanceId],
  );
  const [mouseWanted, setMouseWanted] = useState(tracker.enabled);
  const terminalRef = useRef<HTMLDivElement>(null);

  const setTerminalHandle = useCallback(
    (value: TerminalHandleLike | null) => {
      setHandle(value);
      assignRef(handleRef, value);
    },
    [handleRef],
  );

  useEffect(() => {
    setMouseWanted(tracker.enabled);
    if (!handle) return;
    return handle.subscribeOutput((data) => {
      if (tracker.feed(data)) setMouseWanted(tracker.enabled);
    });
  }, [handle, tracker]);

  // The terminal gets a connect config, not `host`: it then reads the shell's
  // own record for the host, which carries its font, theme and toolbar
  // settings. Ours only carries this plugin's.
  const terminalHostConfig = useMemo(() => {
    if (!host) return null;
    const port = host.sshPort ?? host.port;
    return { ...host, port, sshPort: port, instanceId };
  }, [host, instanceId]);

  const notifySettingRef = useRef(notifySetting);
  notifySettingRef.current = notifySetting;

  const refresh = useCallback(async () => {
    if (!Number.isFinite(hostId)) return;
    try {
      const nextState = await api.state();
      if (nextState.available) {
        if (
          nextState.snapshot.runtime === "hc" &&
          runtimeRef.current !== "hc"
        ) {
          const initialTerm = nextState.snapshot.focused_terminal_id ?? null;
          setRuntime("hc");
          setAttachedTerminalId(initialTerm);
          setHandle(null);
          setInstanceId(newInstanceId());
        }
        const prev = prevAgentStatusRef.current;
        const nextMap = new Map<string, AgentStatus>();
        for (const agent of nextState.snapshot.agents) {
          nextMap.set(agent.pane_id, agent.agent_status);
          if (prev && notifySettingRef.current !== "off") {
            const oldStatus = prev.get(agent.pane_id);
            const name = agent.label || agent.agent || agent.pane_id;
            if (oldStatus && oldStatus !== agent.agent_status) {
              const workspace =
                nextState.snapshot.workspaces.find(
                  (ws) => ws.workspace_id === agent.workspace_id,
                )?.label || agent.workspace_id;
              if (agent.agent_status === "blocked") {
                toast.warning(
                  t("notifications.agentBlocked", { name, workspace }),
                );
              } else if (agent.agent_status === "error") {
                toast.error(t("notifications.agentError", { name, workspace }));
              } else if (
                agent.agent_status === "done" &&
                (oldStatus === "working" || oldStatus === "blocked") &&
                notifySettingRef.current === "all"
              ) {
                toast.success(
                  t("notifications.agentDone", { name, workspace }),
                );
              }
            }
          }
        }
        prevAgentStatusRef.current = nextMap;
      }
      setState(nextState);
    } catch (err) {
      setState({
        available: false,
        code: "HERDR_ERROR",
        error: apiErrorMessage(err),
      });
    }
  }, [api, hostId, t, toast]);

  useEffect(() => {
    if (!navigatorOpen || !Number.isFinite(hostId)) return;
    let cancelled = false;
    void api
      .sessions()
      .then((res) => {
        if (!cancelled && Array.isArray(res?.sessions)) {
          setSessions(res.sessions);
        }
      })
      .catch(() => {
        // Ignore when sessions cannot be queried yet.
      });
    return () => {
      cancelled = true;
    };
  }, [navigatorOpen, hostId, api]);

  // Poll while visible: often with the navigator open, slowly otherwise so
  // the header can still flag agents that need you.
  useEffect(() => {
    if (!isVisible || !Number.isFinite(hostId)) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") await refresh();
      if (!stopped) {
        timer = window.setTimeout(
          tick,
          navigatorOpen ? POLL_OPEN_MS : POLL_CLOSED_MS,
        );
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [isVisible, hostId, navigatorOpen, refresh]);

  const run = useCallback(
    async (action: ActionName, params?: Record<string, unknown>) => {
      try {
        const nextTerm =
          runtimeRef.current === "hc"
            ? resolveFocusTerminalId(snapshotRef.current, action, params)
            : null;
        await api.action(action, params);
        if (nextTerm && nextTerm !== attachedTerminalRef.current) {
          setAttachedTerminalId(nextTerm);
          setHandle(null);
          setInstanceId(newInstanceId());
        }
        void refresh();
        return true;
      } catch (err) {
        if (
          action === "workspace.close" &&
          !params?.group &&
          apiHerdrCode(err) === "workspace_group_close_required"
        ) {
          const ok = await confirm({
            title: t("navigator.confirm.workspaceGroupClose"),
            description: t("navigator.confirm.description"),
            confirmLabel: t("navigator.close"),
            destructive: true,
          });
          if (ok) {
            try {
              await api.action("workspace.close", { ...params, group: true });
              void refresh();
              return true;
            } catch (retryErr) {
              toast.error(apiErrorMessage(retryErr));
              return false;
            }
          }
          return false;
        }
        toast.error(apiErrorMessage(err));
        return false;
      }
    },
    [api, confirm, refresh, t, toast],
  );

  const selectSession = useCallback(
    (nextSession: string) => {
      const normalized = nextSession === "default" ? "" : nextSession;
      if ((sessionOverride ?? configuredSession ?? "") === normalized) return;
      setSessionOverride(normalized);
      setState(null);
      setHandle(null);
      setInstanceId(newInstanceId());
    },
    [sessionOverride, configuredSession],
  );

  /** The current snapshot, fetching one when there is none yet. */
  const currentSnapshot = useCallback(async () => {
    if (snapshotRef.current) return snapshotRef.current;
    await refresh();
    return snapshotRef.current;
  }, [refresh]);

  const keyBarActions = useMemo<KeyBarActions>(() => {
    const withPane = (fn: (paneId: string) => void) => async () => {
      const snapshot = await currentSnapshot();
      if (snapshot?.focused_pane_id) fn(snapshot.focused_pane_id);
    };
    const stepTab = (step: number) => async () => {
      const snapshot = await currentSnapshot();
      if (!snapshot) return;
      const tabs = snapshot.tabs
        .filter((entry) => entry.workspace_id === snapshot.focused_workspace_id)
        .sort((a, b) => a.number - b.number);
      if (tabs.length < 2) return;
      const index = tabs.findIndex(
        (entry) => entry.tab_id === snapshot.focused_tab_id,
      );
      const next = tabs[(index + step + tabs.length) % tabs.length];
      void run("tab.focus", { tabId: next.tab_id });
    };
    return {
      newTab: async () => {
        const snapshot = await currentSnapshot();
        if (snapshot?.focused_workspace_id) {
          void run("tab.create", {
            workspaceId: snapshot.focused_workspace_id,
          });
        }
      },
      previousTab: stepTab(-1),
      nextTab: stepTab(1),
      splitRight: withPane(
        (paneId) => void run("pane.split", { paneId, direction: "right" }),
      ),
      splitDown: withPane(
        (paneId) => void run("pane.split", { paneId, direction: "down" }),
      ),
      zoom: withPane((paneId) => void run("pane.zoom", { paneId })),
    };
  }, [currentSnapshot, run]);

  const send = useCallback((data: string) => handle?.sendInput(data), [handle]);
  const readGrid = useCallback(
    () => (terminalRef.current ? readTerminalGrid(terminalRef.current) : null),
    [],
  );

  if (!host || !Number.isFinite(hostId)) {
    return <EmptyState icon={Bot} title={t("tab.noHost")} />;
  }
  if (!TerminalView) {
    return (
      <EmptyState
        icon={TerminalSquare}
        title={t("tab.needsTerminal")}
        hint={t("tab.needsTerminalHint")}
      />
    );
  }
  if (!launch || !terminalHostConfig) {
    return (
      <EmptyState
        icon={Bot}
        title={t("tab.badSettings")}
        hint={t("tab.badSettingsHint")}
      />
    );
  }

  const snapshot = snapshotRef.current;
  const failure = failureOf(state);
  const waiting = snapshot?.agents.filter(
    (agent) =>
      agent.agent_status === "blocked" || agent.agent_status === "error",
  ).length;
  const layerActive = touchOn && mouseWanted && Boolean(handle);

  const status = failure
    ? t(`errors.${failure.code}`)
    : snapshot
      ? (snapshot.workspaces.find((ws) => ws.focused)?.label ?? "")
      : t("status.connecting");

  const navigator = (
    <div className="flex h-full flex-col overflow-y-auto">
      {snapshot ? (
        <Navigator
          snapshot={snapshot}
          run={run}
          readPane={api.readPane}
          sessions={sessions}
          activeSession={activeSession}
          onSelectSession={selectSession}
          onCloseNavigator={
            isMobile ? () => setNavigatorOpen(false) : undefined
          }
        />
      ) : (
        <EmptyState
          icon={Bot}
          title={failure ? t(`errors.${failure.code}`) : t("status.connecting")}
          hint={failure?.error}
        />
      )}
    </div>
  );

  return (
    <PanelShell
      icon={<Bot className="size-4" />}
      title={host.name || t("tab.title")}
      status={status}
      docs={docs}
      scroll={false}
      actions={
        <>
          <ListRowAction
            label={t(touchOn ? "toolbar.touchOff" : "toolbar.touchOn")}
            tone={touchOn ? "brand" : "default"}
            aria-pressed={touchOn}
            onClick={() => setTouchOn((on) => !on)}
          >
            <MousePointerClick className="size-4" />
          </ListRowAction>
          <ListRowAction
            label={t(keyBarOn ? "toolbar.keysOff" : "toolbar.keysOn")}
            tone={keyBarOn ? "brand" : "default"}
            aria-pressed={keyBarOn}
            onClick={() => setKeyBarOn((on) => !on)}
          >
            <Keyboard className="size-4" />
          </ListRowAction>
          <ListRowAction
            label={t("toolbar.navigator")}
            tone={navigatorOpen ? "brand" : "default"}
            aria-pressed={navigatorOpen}
            onClick={() => setNavigatorOpen((open) => !open)}
          >
            <span className="relative flex">
              <ListTree className="size-4" />
              {Boolean(waiting) && (
                <span className="absolute -right-2 -top-2">
                  <ListBadge tone="warning">{waiting}</ListBadge>
                </span>
              )}
            </span>
          </ListRowAction>
          <ListRowAction
            label={t("toolbar.reattach")}
            onClick={() => {
              setHandle(null);
              setInstanceId(newInstanceId());
            }}
          >
            <RotateCw className="size-4" />
          </ListRowAction>
        </>
      }
    >
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div
            ref={terminalRef}
            className="relative min-h-0 flex-1 overflow-hidden"
          >
            <TerminalView
              key={instanceId}
              handleRef={setTerminalHandle}
              hostConfig={terminalHostConfig}
              isVisible={isVisible}
              title={host.name}
              showTitle={false}
              splitScreen={false}
              executeCommand={launch}
              disableAutoFocus={touchDevice}
            />
            {layerActive && (
              <TouchMouseLayer
                readGrid={readGrid}
                send={send}
                longPressMs={longPressMs}
              />
            )}
          </div>
          {keyBarOn && (
            <KeyBar
              send={send}
              prefix={prefix}
              appCursor={() => handle?.getApplicationCursorKeysMode() ?? false}
              showKeyboard={() => handle?.focus()}
              actions={keyBarActions}
            />
          )}
          {navigatorOpen && isMobile && (
            <div className="absolute inset-0 z-20 bg-background">
              {navigator}
            </div>
          )}
        </div>
        {navigatorOpen && !isMobile && (
          <aside className="w-80 shrink-0 border-l border-border">
            {navigator}
          </aside>
        )}
      </div>
    </PanelShell>
  );
}
