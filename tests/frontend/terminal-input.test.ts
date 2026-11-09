import { describe, expect, it } from "vitest";
import {
  MouseButton,
  MouseModeTracker,
  cellAt,
  charBytes,
  keyBytes,
  prefixBytes,
  readTerminalGrid,
  sgrClick,
  sgrMouse,
} from "../../src/frontend/terminal-input";

const NONE = { ctrl: false, alt: false, shift: false };

describe("SGR mouse reports", () => {
  it("encodes press, release, motion and wheel", () => {
    expect(sgrMouse(MouseButton.left, { col: 5, row: 3 })).toBe("\x1b[<0;5;3M");
    expect(
      sgrMouse(MouseButton.left, { col: 5, row: 3 }, { release: true }),
    ).toBe("\x1b[<0;5;3m");
    expect(
      sgrMouse(MouseButton.left, { col: 6, row: 3 }, { motion: true }),
    ).toBe("\x1b[<32;6;3M");
    expect(sgrMouse(MouseButton.wheelDown, { col: 1, row: 1 })).toBe(
      "\x1b[<65;1;1M",
    );
    expect(sgrClick(MouseButton.right, { col: 2, row: 9 })).toBe(
      "\x1b[<2;2;9M\x1b[<2;2;9m",
    );
  });
});

describe("cellAt", () => {
  const grid = {
    left: 10,
    top: 20,
    width: 400,
    height: 240,
    cols: 50,
    rows: 12,
  };
  it("maps a point to a 1-based cell", () => {
    expect(cellAt(grid, 10, 20)).toEqual({ col: 1, row: 1 });
    expect(cellAt(grid, 10 + 8 * 4 + 1, 20 + 20 * 2 + 1)).toEqual({
      col: 5,
      row: 3,
    });
  });
  it("clamps points outside the grid", () => {
    expect(cellAt(grid, 0, 0)).toEqual({ col: 1, row: 1 });
    expect(cellAt(grid, 9999, 9999)).toEqual({ col: 50, row: 12 });
  });
});

describe("readTerminalGrid", () => {
  it("reads rows from the row elements and columns from the cell width", () => {
    document.body.innerHTML = `
      <div id="root"><div class="xterm-screen"><div class="xterm-rows">
        <div></div><div></div><div></div>
      </div></div></div>`;
    const root = document.getElementById("root")!;
    const screen = root.querySelector(".xterm-screen")!;
    screen.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 360, height: 60 }) as DOMRect;
    // jsdom has no layout: give the "W" probe a width of 9px per character.
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.textContent?.startsWith("WWW")) {
        return { width: this.textContent.length * 9 } as DOMRect;
      }
      return original.call(this);
    };
    try {
      expect(readTerminalGrid(root)).toEqual({
        left: 0,
        top: 0,
        width: 360,
        height: 60,
        cols: 40,
        rows: 3,
      });
      // The probe is removed again.
      expect(root.querySelector(".xterm-rows")!.children).toHaveLength(3);

      // Subsequent calls with the same dimensions reuse the cached cell width
      // without re-inserting the DOM probe.
      let probeCount = 0;
      HTMLElement.prototype.getBoundingClientRect = function () {
        if (this.textContent?.startsWith("WWW")) {
          probeCount++;
          return { width: this.textContent.length * 9 } as DOMRect;
        }
        return original.call(this);
      };
      expect(readTerminalGrid(root)?.cols).toBe(40);
      expect(probeCount).toBe(0);

      // Resizing the screen invalidates the cache and re-probes.
      screen.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 450, height: 60 }) as DOMRect;
      expect(readTerminalGrid(root)?.cols).toBe(50);
      expect(probeCount).toBe(1);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });

  it("returns null without an xterm", () => {
    document.body.innerHTML = "<div id='root'></div>";
    expect(readTerminalGrid(document.getElementById("root")!)).toBeNull();
  });
});

describe("MouseModeTracker", () => {
  it("turns on and off with DECSET and DECRST, across chunk boundaries", () => {
    const tracker = new MouseModeTracker(false);
    expect(tracker.enabled).toBe(false);
    expect(tracker.feed("hello \x1b[?100")).toBe(false);
    expect(tracker.feed("0h\x1b[?1006h")).toBe(true);
    expect(tracker.enabled).toBe(true);
    expect(tracker.feed("\x1b[?1006l\x1b[?1000l")).toBe(true);
    expect(tracker.enabled).toBe(false);
  });

  it("handles combined modes in one sequence", () => {
    const tracker = new MouseModeTracker(false);
    tracker.feed("\x1b[?1049;1002;1006h");
    expect(tracker.enabled).toBe(true);
  });

  it("starts on when assumed, until the program says otherwise", () => {
    const tracker = new MouseModeTracker(true);
    expect(tracker.enabled).toBe(true);
    tracker.feed("\x1b[?1000l");
    expect(tracker.enabled).toBe(false);
  });
});

describe("keys", () => {
  it("sends the configured prefix", () => {
    expect(prefixBytes("ctrl+b")).toBe("\x02");
    expect(prefixBytes("ctrl+a")).toBe("\x01");
    expect(prefixBytes("f12")).toBe("\x1b[24~");
    expect(prefixBytes("nonsense")).toBe("\x02");
  });

  it("encodes arrows for normal and application cursor mode", () => {
    expect(keyBytes("up", NONE, false)).toBe("\x1b[A");
    expect(keyBytes("up", NONE, true)).toBe("\x1bOA");
    expect(keyBytes("left", { ...NONE, ctrl: true }, true)).toBe("\x1b[1;5D");
    expect(keyBytes("right", { ...NONE, shift: true }, false)).toBe(
      "\x1b[1;2C",
    );
  });

  it("encodes the other keys", () => {
    expect(keyBytes("esc", NONE, false)).toBe("\x1b");
    expect(keyBytes("tab", NONE, false)).toBe("\t");
    expect(keyBytes("tab", { ...NONE, shift: true }, false)).toBe("\x1b[Z");
    expect(keyBytes("shiftTab", NONE, false)).toBe("\x1b[Z");
    expect(keyBytes("backspace", NONE, false)).toBe("\x7f");
    expect(keyBytes("slash", NONE, false)).toBe("/");
    expect(keyBytes("enter", { ...NONE, alt: true }, false)).toBe("\x1b\r");
    expect(keyBytes("ctrlC", NONE, false)).toBe("\x03");
    expect(keyBytes("ctrlZ", NONE, false)).toBe("\x1a");
    expect(keyBytes("ctrlL", NONE, false)).toBe("\x0c");
    expect(keyBytes("pageUp", NONE, false)).toBe("\x1b[5~");
  });

  it("applies Shift, Ctrl and Alt to a typed character", () => {
    expect(charBytes("a", { ...NONE, shift: true })).toBe("A");
    expect(charBytes("c", { ...NONE, ctrl: true })).toBe("\x03");
    expect(charBytes("R", { ...NONE, ctrl: true })).toBe("\x12");
    expect(charBytes("x", { ...NONE, alt: true })).toBe("\x1bx");
    expect(charBytes("b", { ...NONE, ctrl: true, alt: true })).toBe("\x1b\x02");
  });
});
