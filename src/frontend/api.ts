import type { PluginApiClient } from "@termix-ssh/plugin-sdk/frontend";
import type { HerdrSessionInfo, HerdrState } from "../shared/herdr";

export type ActionName =
  | "workspace.focus"
  | "workspace.create"
  | "workspace.rename"
  | "workspace.close"
  | "worktree.create"
  | "worktree.remove"
  | "tab.focus"
  | "tab.create"
  | "tab.rename"
  | "tab.close"
  | "pane.focus"
  | "pane.rename"
  | "pane.split"
  | "pane.resize"
  | "pane.swap"
  | "pane.zoom"
  | "pane.close"
  | "pane.sendText"
  | "pane.sendKeys"
  | "pane.run"
  | "agent.prompt"
  | "agent.start";

export interface HerdrSessionsResponse {
  activeSession: string;
  sessions: HerdrSessionInfo[];
}

export interface HerdrApi {
  state: () => Promise<HerdrState>;
  sessions: () => Promise<HerdrSessionsResponse>;
  action: (
    action: ActionName,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  readPane: (paneId: string, lines?: number) => Promise<string>;
}

/** The error message the backend sent, or the request's own. */
export function apiErrorMessage(err: unknown): string {
  const data = (err as { response?: { data?: { error?: unknown } } })?.response
    ?.data;
  if (typeof data?.error === "string") return data.error;
  return err instanceof Error ? err.message : String(err);
}

/** Error code from herdr itself, e.g. workspace_group_close_required. */
export function apiHerdrCode(err: unknown): string | undefined {
  const data = (err as { response?: { data?: { herdrCode?: unknown } } })
    ?.response?.data;
  return typeof data?.herdrCode === "string" ? data.herdrCode : undefined;
}

export function herdrApi(
  api: PluginApiClient,
  hostId: number,
  session?: string,
): HerdrApi {
  const base = `/hosts/${hostId}`;
  const sessionParam =
    session !== undefined
      ? `session=${encodeURIComponent(session || "default")}`
      : "";
  const withSession = (url: string) =>
    sessionParam
      ? `${url}${url.includes("?") ? "&" : "?"}${sessionParam}`
      : url;
  return {
    state: async () =>
      (await api.get<HerdrState>(withSession(`${base}/state`))).data,
    sessions: async () => {
      const { data } = await api.get<Partial<HerdrSessionsResponse>>(
        withSession(`${base}/sessions`),
      );
      return {
        activeSession:
          typeof data?.activeSession === "string"
            ? data.activeSession
            : session || "default",
        sessions: Array.isArray(data?.sessions) ? data.sessions : [],
      };
    },
    action: async (action, params = {}) =>
      (
        await api.post<{ result: unknown }>(`${base}/actions`, {
          action,
          params,
          ...(session !== undefined ? { session: session || "default" } : {}),
        })
      ).data.result,
    readPane: async (paneId, lines = 80) => {
      const { data } = await api.get<{ text?: string }>(
        withSession(
          `${base}/panes/${encodeURIComponent(paneId)}/read?lines=${lines}`,
        ),
      );
      return typeof data?.text === "string" ? data.text : "";
    },
  };
}
