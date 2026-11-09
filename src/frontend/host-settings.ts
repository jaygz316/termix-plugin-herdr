import type { PluginHostRecord } from "@termix-ssh/plugin-sdk/frontend";
import {
  HOST_SETTINGS,
  PLUGIN_ID,
  launchCommand,
  normalizeBinary,
  normalizeSession,
} from "../shared/herdr";

function settingsOf(
  host: PluginHostRecord | null | undefined,
): Record<string, unknown> {
  return (
    (
      host?.pluginSettings as
        Record<string, Record<string, unknown>> | undefined
    )?.[PLUGIN_ID] ?? {}
  );
}

/** Whether herdr is on for this host. It is on until a host turns it off. */
export function herdrEnabled(
  host: PluginHostRecord | null | undefined,
): boolean {
  return settingsOf(host)[HOST_SETTINGS.enabled] !== false;
}

/** The configured session name for this host ("" for default), or null when invalid. */
export function herdrSessionName(
  host: PluginHostRecord | null | undefined,
): string | null {
  return normalizeSession(settingsOf(host)[HOST_SETTINGS.session]);
}

/**
 * What to type into the host's shell to attach herdr, or null when the
 * host's herdr path or session name is not usable.
 */
export function herdrLaunchCommand(
  host: PluginHostRecord | null | undefined,
  sessionOverride?: string,
): string | null {
  const settings = settingsOf(host);
  const binary = normalizeBinary(settings[HOST_SETTINGS.binary]);
  const session = normalizeSession(
    sessionOverride !== undefined
      ? sessionOverride
      : settings[HOST_SETTINGS.session],
  );
  if (binary === null || session === null) return null;
  return launchCommand(binary, session);
}
