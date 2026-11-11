// Bytes a real terminal would send: SGR mouse reports, the prefix key and the
// keys a phone keyboard lacks. Kept free of React so it can be tested alone.

export interface Cell {
  /** 1-based column, as the SGR mouse protocol counts. */
  col: number;
  /** 1-based row. */
  row: number;
}

export interface TerminalGrid {
  /** The xterm screen element's box on the page. */
  left: number;
  top: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
}

export const MouseButton = {
  left: 0,
  middle: 1,
  right: 2,
  wheelUp: 64,
  wheelDown: 65,
} as const;

const MOTION = 32;

/**
 * One SGR (mode 1006) mouse report. herdr turns on 1000, 1002, 1003 and 1006,
 * so this is exactly what a desktop terminal sends it.
 */
export function sgrMouse(
  button: number,
  cell: Cell,
  options: { release?: boolean; motion?: boolean } = {},
): string {
  const code = button + (options.motion ? MOTION : 0);
  return `\x1b[<${code};${cell.col};${cell.row}${options.release ? "m" : "M"}`;
}

/** A press and release, which is what a click is. */
export function sgrClick(button: number, cell: Cell): string {
  return sgrMouse(button, cell) + sgrMouse(button, cell, { release: true });
}

/** The cell under a point, clamped to the grid. */
export function cellAt(grid: TerminalGrid, x: number, y: number): Cell {
  const cellWidth = grid.width / grid.cols;
  const cellHeight = grid.height / grid.rows;
  const col = Math.floor((x - grid.left) / cellWidth) + 1;
  const row = Math.floor((y - grid.top) / cellHeight) + 1;
  return {
    col: Math.min(Math.max(col, 1), grid.cols),
    row: Math.min(Math.max(row, 1), grid.rows),
  };
}

const MEASURE_CHARS = 50;

interface CachedCellWidth {
  rows: number;
  width: number;
  height: number;
  charWidth: number;
}

const cellWidthCache = new WeakMap<Element, CachedCellWidth>();

/**
 * Reads the grid of the xterm.js terminal inside `root`. The terminal plugin
 * uses xterm's DOM renderer: `.xterm-rows` has one element per row and the
 * screen is exactly cols × cell width wide. The cell width is measured with a
 * run of "W" inside the row container, which carries the terminal's font and
 * the letter spacing xterm uses to make each glyph one cell wide, and is
 * cached until the screen size or row count changes.
 */
export function readTerminalGrid(root: ParentNode): TerminalGrid | null {
  const screen = root.querySelector<HTMLElement>(".xterm-screen");
  const rowContainer = root.querySelector<HTMLElement>(".xterm-rows");
  if (!screen || !rowContainer) return null;
  const rows = rowContainer.children.length;
  const box = screen.getBoundingClientRect();
  if (rows < 1 || box.width <= 0 || box.height <= 0) return null;

  const cached = cellWidthCache.get(rowContainer);
  let charWidth =
    cached &&
    cached.rows === rows &&
    cached.width === box.width &&
    cached.height === box.height
      ? cached.charWidth
      : 0;

  if (!(charWidth > 0)) {
    const probe = document.createElement("span");
    probe.textContent = "W".repeat(MEASURE_CHARS);
    probe.setAttribute("aria-hidden", "true");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "pre";
    probe.style.left = "0";
    probe.style.top = "0";
    rowContainer.appendChild(probe);
    charWidth = probe.getBoundingClientRect().width / MEASURE_CHARS;
    probe.remove();
    if (!(charWidth > 0)) return null;
    cellWidthCache.set(rowContainer, {
      rows,
      width: box.width,
      height: box.height,
      charWidth,
    });
  }

  const cols = Math.max(1, Math.round(box.width / charWidth));
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    cols,
    rows,
  };
}

/**
 * Follows DECSET / DECRST for the mouse tracking modes in a terminal's
 * output, so taps are only turned into mouse reports while the program in
 * the terminal (herdr) asked for them. Anything else gets plain taps.
 */
export class MouseModeTracker {
  private modes = new Set<number>();
  private tail = "";

  constructor(private assumeOn: boolean) {}

  /** Whether the program wants mouse reports. */
  get enabled(): boolean {
    if (this.assumeOn) return true;
    return [1000, 1002, 1003].some((mode) => this.modes.has(mode));
  }

  /** Feeds a chunk of terminal output. Returns true when `enabled` changed. */
  feed(data: string): boolean {
    const before = this.enabled;
    // A sequence can be split across chunks; keep a short tail.
    const text = this.tail + data;
    this.tail = text.slice(-24);
    const re = /\x1b\[\?([\d;]+)([hl])/g;
    let match: RegExpExecArray | null;
    let saw = false;
    while ((match = re.exec(text)) !== null) {
      for (const part of match[1].split(";")) {
        const mode = Number(part);
        if (mode < 1000 || mode > 1006) continue;
        saw = true;
        if (match[2] === "h") this.modes.add(mode);
        else this.modes.delete(mode);
      }
    }
    // Once the program has said anything about the mouse, trust it.
    if (saw) this.assumeOn = false;
    // A reset (RIS) clears every mode.
    if (text.includes("\x1bc")) {
      this.modes.clear();
      this.assumeOn = false;
    }
    return before !== this.enabled;
  }
}

export type PrefixKey = "ctrl+b" | "ctrl+a" | "ctrl+space" | "ctrl+g" | "f12";

const PREFIX_BYTES: Record<PrefixKey, string> = {
  "ctrl+b": "\x02",
  "ctrl+a": "\x01",
  "ctrl+space": "\x00",
  "ctrl+g": "\x07",
  f12: "\x1b[24~",
};

export function prefixBytes(key: unknown): string {
  return PREFIX_BYTES[key as PrefixKey] ?? PREFIX_BYTES["ctrl+b"];
}

export type BarKey =
  | "esc"
  | "tab"
  | "shiftTab"
  | "enter"
  | "backspace"
  | "slash"
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "end"
  | "pageUp"
  | "pageDown"
  | "ctrlC"
  | "ctrlD"
  | "ctrlZ"
  | "ctrlL"
  | "ctrlBackslash";

export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

const ARROWS: Partial<Record<BarKey, string>> = {
  up: "A",
  down: "B",
  right: "C",
  left: "D",
  home: "H",
  end: "F",
};

/**
 * The bytes for a key bar key with the sticky modifiers applied, as xterm
 * encodes them. `appCursor` is DECCKM, which full-screen programs turn on.
 */
export function keyBytes(
  key: BarKey,
  mods: Modifiers,
  appCursor: boolean,
): string {
  // xterm's modifier parameter: 1 + shift + 2*alt + 4*ctrl.
  const param =
    1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
  const arrow = ARROWS[key];
  if (arrow) {
    if (param > 1) return `\x1b[1;${param}${arrow}`;
    return appCursor ? `\x1bO${arrow}` : `\x1b[${arrow}`;
  }
  const alt = mods.alt ? "\x1b" : "";
  switch (key) {
    case "esc":
      return "\x1b";
    case "tab":
      return mods.shift ? "\x1b[Z" : alt + "\t";
    case "shiftTab":
      return "\x1b[Z";
    case "enter":
      return alt + "\r";
    case "backspace":
      return alt + "\x7f";
    case "slash":
      return alt + "/";
    case "pageUp":
      return param > 1 ? `\x1b[5;${param}~` : "\x1b[5~";
    case "pageDown":
      return param > 1 ? `\x1b[6;${param}~` : "\x1b[6~";
    case "ctrlC":
      return alt + "\x03";
    case "ctrlD":
      return alt + "\x04";
    case "ctrlZ":
      return alt + "\x1a";
    case "ctrlL":
      return alt + "\x0c";
    case "ctrlBackslash":
      return alt + "\x1c";
    default:
      return "";
  }
}

/** A typed character with the sticky Ctrl, Alt and Shift applied. */
export function charBytes(char: string, mods: Modifiers): string {
  let out = mods.shift && !mods.ctrl ? char.toUpperCase() : char;
  if (mods.ctrl && char.length === 1) {
    const code = char.toLowerCase().charCodeAt(0);
    if (code >= 97 && code <= 122) out = String.fromCharCode(code - 96);
    else if (char === " " || char === "@") out = "\x00";
    else if (char === "[") out = "\x1b";
    else if (char === "\\") out = "\x1c";
    else if (char === "]") out = "\x1d";
  }
  return (mods.alt ? "\x1b" : "") + out;
}
