import { Bot } from "lucide-react";
import type {
  PluginHostRecord,
  TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { HerdrTab } from "./HerdrTab";
import { herdrEnabled } from "./host-settings";

const TAB_ID = "herdr";

function canUse(host: PluginHostRecord | null | undefined): boolean {
  return Boolean(host) && host!.enableSsh !== false && herdrEnabled(host);
}

export function activate(app: TermixApp): void {
  app.registerTab(TAB_ID, HerdrTab, {
    icon: Bot,
    titleKey: "tab.title",
    requiresHost: true,
    noHostMessageKey: "tab.noHost",
    session: true,
    persistent: true,
  });

  app.registerHostAction({
    id: TAB_ID,
    titleKey: "tab.open",
    icon: Bot,
    kind: "open",
    order: 72,
    when: canUse,
    run: (host, shell) => shell.openTab(host, TAB_ID),
  });

  app.registerHostContextMenuItem({
    id: TAB_ID,
    titleKey: "tab.open",
    icon: Bot,
    when: canUse,
    run: (host, shell) => shell.openTab(host, TAB_ID),
  });

  app.registerPaletteEntry({
    id: TAB_ID,
    titleKey: "tab.open",
    icon: Bot,
    scope: "host",
    when: canUse,
    run: (shell, host) => {
      if (host) shell.openTab(host, TAB_ID);
    },
  });
}
