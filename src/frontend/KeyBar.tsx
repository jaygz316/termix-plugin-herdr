import { useState, type ReactNode } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { cn } from "@termix-ssh/plugin-sdk/ui";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Delete,
  Keyboard,
  LayoutList,
  Maximize2,
  Navigation,
  PanelLeft,
  Plus,
  SquareSplitHorizontal,
  SquareSplitVertical,
} from "lucide-react";
import {
  charBytes,
  keyBytes,
  type BarKey,
  type Modifiers,
} from "./terminal-input";

export interface KeyBarActions {
  newTab: () => void;
  previousTab: () => void;
  nextTab: () => void;
  splitRight: () => void;
  splitDown: () => void;
  zoom: () => void;
}

interface KeyBarProps {
  send: (data: string) => void;
  prefix: string;
  appCursor: () => boolean;
  /** Focuses the terminal, which opens the phone's keyboard. */
  showKeyboard: () => void;
  actions: KeyBarActions;
}

const NO_MODS: Modifiers = { ctrl: false, alt: false, shift: false };

function BarButton({
  label,
  onPress,
  active,
  children,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // Keep focus (and the phone keyboard) where it is.
      onPointerDown={(event) => event.preventDefault()}
      onClick={onPress}
      className={cn(
        "flex h-9 min-w-9 shrink-0 items-center justify-center border border-border px-2 text-xs",
        "active:bg-muted",
        active
          ? "border-accent-brand text-accent-brand"
          : "bg-background text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The keys a phone keyboard lacks, plus herdr's own actions. Ctrl, Alt and
 * Shift latch: the next key bar key, or the next character typed into the
 * small box that appears, gets them.
 */
export function KeyBar({
  send,
  prefix,
  appCursor,
  showKeyboard,
  actions,
}: KeyBarProps) {
  const { t } = useTranslation();
  const [mods, setMods] = useState<Modifiers>(NO_MODS);
  const latched = mods.ctrl || mods.alt || mods.shift;
  const activeModNames = [
    mods.ctrl ? t("keys.ctrl") : null,
    mods.alt ? t("keys.alt") : null,
    mods.shift ? t("keys.shift") : null,
  ].filter(Boolean);

  function key(name: BarKey) {
    send(keyBytes(name, mods, appCursor()));
    setMods(NO_MODS);
  }

  function prefixThen(char: string) {
    send(prefix + char);
  }

  return (
    <div
      className="flex shrink-0 flex-col gap-1 border-t border-border bg-background p-1"
      data-testid="herdr-key-bar"
    >
      <div className="flex gap-1 overflow-x-auto">
        <BarButton label={t("keys.keyboard")} onPress={showKeyboard}>
          <Keyboard className="size-4" />
        </BarButton>
        <BarButton label={t("keys.prefixHint")} onPress={() => send(prefix)}>
          {t("keys.prefix")}
        </BarButton>
        <BarButton
          label={t("keys.ctrl")}
          active={mods.ctrl}
          onPress={() => setMods((m) => ({ ...m, ctrl: !m.ctrl }))}
        >
          {t("keys.ctrl")}
        </BarButton>
        <BarButton
          label={t("keys.alt")}
          active={mods.alt}
          onPress={() => setMods((m) => ({ ...m, alt: !m.alt }))}
        >
          {t("keys.alt")}
        </BarButton>
        <BarButton
          label={t("keys.shift")}
          active={mods.shift}
          onPress={() => setMods((m) => ({ ...m, shift: !m.shift }))}
        >
          {t("keys.shift")}
        </BarButton>
        <BarButton label={t("keys.esc")} onPress={() => key("esc")}>
          {t("keys.esc")}
        </BarButton>
        <BarButton label={t("keys.tab")} onPress={() => key("tab")}>
          {t("keys.tab")}
        </BarButton>
        <BarButton label={t("keys.up")} onPress={() => key("up")}>
          <ArrowUp className="size-4" />
        </BarButton>
        <BarButton label={t("keys.down")} onPress={() => key("down")}>
          <ArrowDown className="size-4" />
        </BarButton>
        <BarButton label={t("keys.left")} onPress={() => key("left")}>
          <ArrowLeft className="size-4" />
        </BarButton>
        <BarButton label={t("keys.right")} onPress={() => key("right")}>
          <ArrowRight className="size-4" />
        </BarButton>
        <BarButton label={t("keys.enter")} onPress={() => key("enter")}>
          <CornerDownLeft className="size-4" />
        </BarButton>
        <BarButton label={t("keys.backspace")} onPress={() => key("backspace")}>
          <Delete className="size-4" />
        </BarButton>
        <BarButton label={t("keys.slash")} onPress={() => key("slash")}>
          /
        </BarButton>
        <BarButton label={t("keys.ctrlC")} onPress={() => key("ctrlC")}>
          ^C
        </BarButton>
        <BarButton label={t("keys.shiftTab")} onPress={() => key("shiftTab")}>
          ⇧{t("keys.tab")}
        </BarButton>
        <BarButton label={t("keys.pageUp")} onPress={() => key("pageUp")}>
          {t("keys.pgUp")}
        </BarButton>
        <BarButton label={t("keys.pageDown")} onPress={() => key("pageDown")}>
          {t("keys.pgDn")}
        </BarButton>
        <BarButton label={t("keys.home")} onPress={() => key("home")}>
          {t("keys.homeShort")}
        </BarButton>
        <BarButton label={t("keys.end")} onPress={() => key("end")}>
          {t("keys.endShort")}
        </BarButton>
        <BarButton label={t("keys.ctrlD")} onPress={() => key("ctrlD")}>
          ^D
        </BarButton>
        <BarButton label={t("keys.ctrlZ")} onPress={() => key("ctrlZ")}>
          ^Z
        </BarButton>
        <BarButton label={t("keys.ctrlL")} onPress={() => key("ctrlL")}>
          ^L
        </BarButton>
      </div>
      {latched ? (
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs text-muted-foreground">
            {`${activeModNames.join("+")} +`}
          </span>
          <input
            autoFocus
            aria-label={t("keys.modifiedKey")}
            className="h-8 w-20 border border-border bg-transparent px-2 text-sm"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value=""
            onChange={(event) => {
              const char = event.target.value.slice(-1);
              if (!char) return;
              send(charBytes(char, mods));
              setMods(NO_MODS);
            }}
          />
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setMods(NO_MODS)}
          >
            {t("keys.cancel")}
          </button>
        </div>
      ) : (
        <div className="flex gap-1 overflow-x-auto">
          <BarButton
            label={t("actions.workspacesHint")}
            onPress={() => prefixThen("w")}
          >
            <LayoutList className="size-4" />
            <span className="ml-1">{t("actions.workspaces")}</span>
          </BarButton>
          <BarButton
            label={t("actions.gotoHint")}
            onPress={() => prefixThen("g")}
          >
            <Navigation className="size-4" />
            <span className="ml-1">{t("actions.goto")}</span>
          </BarButton>
          <BarButton
            label={t("actions.previousTab")}
            onPress={actions.previousTab}
          >
            <ChevronLeft className="size-4" />
          </BarButton>
          <BarButton label={t("actions.newTab")} onPress={actions.newTab}>
            <Plus className="size-4" />
          </BarButton>
          <BarButton label={t("actions.nextTab")} onPress={actions.nextTab}>
            <ChevronRight className="size-4" />
          </BarButton>
          <BarButton
            label={t("actions.splitRight")}
            onPress={actions.splitRight}
          >
            <SquareSplitHorizontal className="size-4" />
          </BarButton>
          <BarButton label={t("actions.splitDown")} onPress={actions.splitDown}>
            <SquareSplitVertical className="size-4" />
          </BarButton>
          <BarButton label={t("actions.zoom")} onPress={actions.zoom}>
            <Maximize2 className="size-4" />
          </BarButton>
          <BarButton
            label={t("actions.sidebarHint")}
            onPress={() => prefixThen("b")}
          >
            <PanelLeft className="size-4" />
          </BarButton>
        </div>
      )}
    </div>
  );
}
