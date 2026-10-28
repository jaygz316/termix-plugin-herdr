import type { PluginApiClient } from "@termix-ssh/plugin-sdk/frontend";
import type { HerdrState } from "../shared/herdr";

export type ActionName =
  | "workspace.focus"
  | "workspace.create"
  | "workspace.rename"
  | "workspace.close"
  | "tab.focus"
  | "tab.create"
  | "tab.rename"
  | "tab.close"
  | "pane.focus"
  | "pane.split"
  | "pane.zoom"
  | "pane.close"
  | "pane.sendText"
  | "pane.sendKeys"
  | "pane.run"
  | "agent.prompt";

export interface HerdrApi {
  state: () => Promise<HerdrState>;
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

export function herdrApi(api: PluginApiClient, hostId: number): HerdrApi {
  const base = `/hosts/${hostId}`;
  return {
    state: async () => (await api.get<HerdrState>(`${base}/state`)).data,
    action: async (action, params = {}) =>
      (
        await api.post<{ result: unknown }>(`${base}/actions`, {
          action,
          params,
        })
      ).data.result,
    readPane: async (paneId, lines = 80) =>
      (
        await api.get<{ text: string }>(
          `${base}/panes/${encodeURIComponent(paneId)}/read?lines=${lines}`,
        )
      ).data.text,
  };
}
