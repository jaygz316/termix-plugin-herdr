import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { TouchMouseLayer } from "../../src/frontend/TouchMouseLayer";

// 10px × 20px cells, 80 × 24, at the page origin.
const grid = { left: 0, top: 0, width: 800, height: 480, cols: 80, rows: 24 };

function setup() {
  const sent: string[] = [];
  const view = render(
    <TouchMouseLayer
      readGrid={() => grid}
      send={(data) => sent.push(data)}
      longPressMs={400}
    />,
  );
  const layer = view.getByTestId("herdr-touch-layer");
  const touch = (
    type: "pointerDown" | "pointerMove" | "pointerUp",
    x: number,
    y: number,
  ) =>
    fireEvent[type](layer, {
      pointerId: 1,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      button: 0,
    });
  return { sent, touch, layer };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TouchMouseLayer", () => {
  it("turns a tap into a left click on the touched cell", () => {
    const { sent, touch } = setup();
    touch("pointerDown", 45, 65);
    touch("pointerUp", 46, 66);
    expect(sent).toEqual(["\x1b[<0;5;4M\x1b[<0;5;4m"]);
  });

  it("turns a long press into a right click", () => {
    const { sent, touch } = setup();
    touch("pointerDown", 15, 5);
    act(() => void vi.advanceTimersByTime(450));
    touch("pointerUp", 15, 5);
    expect(sent).toEqual(["\x1b[<2;2;1M\x1b[<2;2;1m"]);
  });

  it("turns a long press and drag into a left drag", () => {
    const { sent, touch } = setup();
    touch("pointerDown", 5, 5);
    act(() => void vi.advanceTimersByTime(450));
    touch("pointerMove", 35, 5);
    touch("pointerMove", 35, 45);
    touch("pointerUp", 35, 45);
    expect(sent).toEqual([
      "\x1b[<0;1;1M",
      "\x1b[<32;4;1M",
      "\x1b[<32;4;3M",
      "\x1b[<0;4;3m",
    ]);
  });

  it("turns a swipe into wheel notches over the pane under the finger", () => {
    const { sent, touch } = setup();
    touch("pointerDown", 100, 100);
    // Finger moves down 45px: two 20px notches of scrolling back (wheel up).
    touch("pointerMove", 100, 145);
    touch("pointerUp", 100, 145);
    expect(sent).toEqual(["\x1b[<64;11;8M", "\x1b[<64;11;8M"]);
  });

  it("swiping up scrolls forward", () => {
    const { sent, touch } = setup();
    touch("pointerDown", 100, 200);
    touch("pointerMove", 100, 175);
    touch("pointerUp", 100, 175);
    expect(sent).toEqual(["\x1b[<65;11;9M"]);
  });

  it("passes a real mouse through as itself", () => {
    const { sent, layer } = setup();
    const mouse = {
      pointerId: 2,
      pointerType: "mouse",
      clientX: 25,
      clientY: 25,
    };
    fireEvent.pointerDown(layer, { ...mouse, button: 2 });
    fireEvent.pointerUp(layer, { ...mouse, button: 2 });
    expect(sent).toEqual(["\x1b[<2;3;2M", "\x1b[<2;3;2m"]);
  });

  it("cancels when a second finger lands", () => {
    const { sent, layer, touch } = setup();
    touch("pointerDown", 5, 5);
    fireEvent.pointerDown(layer, {
      pointerId: 9,
      pointerType: "touch",
      clientX: 50,
      clientY: 50,
    });
    touch("pointerUp", 5, 5);
    expect(sent).toEqual([]);
  });

  it("turns a two-finger tap into an immediate right click when both fingers lift", () => {
    const { sent, layer, touch } = setup();
    touch("pointerDown", 15, 5);
    fireEvent.pointerDown(layer, {
      pointerId: 9,
      pointerType: "touch",
      clientX: 45,
      clientY: 5,
    });
    touch("pointerUp", 15, 5);
    fireEvent.pointerUp(layer, {
      pointerId: 9,
      pointerType: "touch",
      clientX: 45,
      clientY: 5,
    });
    expect(sent).toEqual(["\x1b[<2;2;1M\x1b[<2;2;1m"]);
  });
});
