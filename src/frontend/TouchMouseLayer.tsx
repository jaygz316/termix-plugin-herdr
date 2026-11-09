import { useEffect, useRef, useState } from "react";
import {
  MouseButton,
  cellAt,
  sgrClick,
  sgrMouse,
  type Cell,
  type TerminalGrid,
} from "./terminal-input";

interface TouchMouseLayerProps {
  /** Reads the terminal grid at the moment of a touch. */
  readGrid: () => TerminalGrid | null;
  /** Writes bytes to the session, as if typed. */
  send: (data: string) => void;
  longPressMs: number;
}

type Gesture =
  | { kind: "pending" }
  | {
      kind: "twoFingerPending";
      secondPointerId: number;
      secondStartX: number;
      secondStartY: number;
      firstReleased: boolean;
      secondReleased: boolean;
    }
  | { kind: "held" }
  | { kind: "scrolling"; lastY: number }
  | { kind: "dragging"; lastCell: Cell }
  | { kind: "mouse"; button: number; lastCell: Cell };

interface Active {
  pointerId: number;
  startX: number;
  startY: number;
  startCell: Cell;
  grid: TerminalGrid;
  gesture: Gesture;
}

/** How far a finger may wander and still be a tap, in CSS pixels. */
const SLOP = 10;

interface Marker {
  left: number;
  top: number;
  width: number;
  height: number;
  kind: "tap" | "hold" | "drag";
}

/**
 * Sits over the terminal while herdr wants the mouse and turns touch into
 * the mouse reports a desktop terminal would send:
 *
 * - tap: left click (select a workspace, a tab, a pane, a button)
 * - two-finger tap or long press and let go: right click (herdr's context menus)
 * - long press then drag: left drag (select text, drag a split border)
 * - swipe: scroll wheel over the pane under the finger
 *
 * A real mouse over the layer is passed through as itself.
 */
export function TouchMouseLayer({
  readGrid,
  send,
  longPressMs,
}: TouchMouseLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<Active | null>(null);
  const timerRef = useRef<number | null>(null);
  const [marker, setMarker] = useState<Marker | null>(null);
  const markerTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (markerTimer.current) window.clearTimeout(markerTimer.current);
    },
    [],
  );

  function showMarker(
    grid: TerminalGrid,
    cell: Cell,
    kind: Marker["kind"],
    linger = 220,
  ) {
    const layer = layerRef.current?.getBoundingClientRect();
    if (!layer) return;
    const width = grid.width / grid.cols;
    const height = grid.height / grid.rows;
    setMarker({
      left: grid.left - layer.left + (cell.col - 1) * width,
      top: grid.top - layer.top + (cell.row - 1) * height,
      width,
      height,
      kind,
    });
    if (markerTimer.current) window.clearTimeout(markerTimer.current);
    if (linger > 0) {
      markerTimer.current = window.setTimeout(() => setMarker(null), linger);
    }
  }

  function clearTimer() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function finish() {
    clearTimer();
    activeRef.current = null;
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (activeRef.current) {
      const current = activeRef.current;
      if (current.gesture.kind === "pending" && event.pointerType !== "mouse") {
        event.preventDefault();
        clearTimer();
        layerRef.current?.setPointerCapture?.(event.pointerId);
        current.gesture = {
          kind: "twoFingerPending",
          secondPointerId: event.pointerId,
          secondStartX: event.clientX,
          secondStartY: event.clientY,
          firstReleased: false,
          secondReleased: false,
        };
        return;
      }
      cancel();
      return;
    }
    const grid = readGrid();
    if (!grid) return;
    event.preventDefault();
    layerRef.current?.setPointerCapture?.(event.pointerId);
    const startCell = cellAt(grid, event.clientX, event.clientY);

    if (event.pointerType === "mouse") {
      const button =
        event.button === 2
          ? MouseButton.right
          : event.button === 1
            ? MouseButton.middle
            : MouseButton.left;
      send(sgrMouse(button, startCell));
      activeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startCell,
        grid,
        gesture: { kind: "mouse", button, lastCell: startCell },
      };
      return;
    }

    activeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCell,
      grid,
      gesture: { kind: "pending" },
    };
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      const active = activeRef.current;
      if (!active || active.gesture.kind !== "pending") return;
      active.gesture = { kind: "held" };
      navigator.vibrate?.(12);
      showMarker(active.grid, active.startCell, "hold", 0);
    }, longPressMs);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const active = activeRef.current;
    if (!active) return;
    if (active.gesture.kind === "twoFingerPending") {
      const g = active.gesture;
      if (event.pointerId === active.pointerId) {
        if (
          Math.hypot(
            event.clientX - active.startX,
            event.clientY - active.startY,
          ) > SLOP
        ) {
          cancel();
        }
      } else if (event.pointerId === g.secondPointerId) {
        if (
          Math.hypot(
            event.clientX - g.secondStartX,
            event.clientY - g.secondStartY,
          ) > SLOP
        ) {
          cancel();
        }
      }
      return;
    }
    if (active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { gesture, grid } = active;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    const distance = Math.hypot(dx, dy);
    const cell = cellAt(grid, event.clientX, event.clientY);

    switch (gesture.kind) {
      case "pending":
        if (distance > SLOP) {
          clearTimer();
          active.gesture = { kind: "scrolling", lastY: active.startY };
          onPointerMove(event);
        }
        return;
      case "scrolling": {
        // One wheel notch per cell height moved; a finger moving down pulls
        // the content down, which is scrolling back (wheel up).
        const step = Math.max(grid.height / grid.rows, 14);
        let delta = event.clientY - gesture.lastY;
        while (Math.abs(delta) >= step) {
          send(
            sgrMouse(
              delta > 0 ? MouseButton.wheelUp : MouseButton.wheelDown,
              cell,
            ),
          );
          gesture.lastY += delta > 0 ? step : -step;
          delta = event.clientY - gesture.lastY;
        }
        return;
      }
      case "held":
        if (distance > SLOP / 2) {
          send(sgrMouse(MouseButton.left, active.startCell));
          active.gesture = { kind: "dragging", lastCell: active.startCell };
          onPointerMove(event);
        }
        return;
      case "dragging":
        if (
          cell.col !== gesture.lastCell.col ||
          cell.row !== gesture.lastCell.row
        ) {
          send(sgrMouse(MouseButton.left, cell, { motion: true }));
          gesture.lastCell = cell;
          showMarker(grid, cell, "drag", 0);
        }
        return;
      case "mouse":
        if (
          cell.col !== gesture.lastCell.col ||
          cell.row !== gesture.lastCell.row
        ) {
          send(sgrMouse(gesture.button, cell, { motion: true }));
          gesture.lastCell = cell;
        }
        return;
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const active = activeRef.current;
    if (!active) return;
    if (active.gesture.kind === "twoFingerPending") {
      const g = active.gesture;
      if (event.pointerId === active.pointerId) {
        g.firstReleased = true;
      } else if (event.pointerId === g.secondPointerId) {
        g.secondReleased = true;
      } else {
        return;
      }
      event.preventDefault();
      if (g.firstReleased && g.secondReleased) {
        send(sgrClick(MouseButton.right, active.startCell));
        showMarker(active.grid, active.startCell, "tap");
        finish();
      }
      return;
    }
    if (active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { gesture, grid, startCell } = active;
    switch (gesture.kind) {
      case "pending":
        send(sgrClick(MouseButton.left, startCell));
        showMarker(grid, startCell, "tap");
        break;
      case "held":
        send(sgrClick(MouseButton.right, startCell));
        showMarker(grid, startCell, "tap");
        break;
      case "dragging":
        send(sgrMouse(MouseButton.left, gesture.lastCell, { release: true }));
        setMarker(null);
        break;
      case "mouse":
        send(sgrMouse(gesture.button, gesture.lastCell, { release: true }));
        break;
      case "scrolling":
        break;
    }
    finish();
  }

  function cancel() {
    const active = activeRef.current;
    if (active?.gesture.kind === "dragging") {
      send(
        sgrMouse(MouseButton.left, active.gesture.lastCell, { release: true }),
      );
    } else if (active?.gesture.kind === "mouse") {
      send(
        sgrMouse(active.gesture.button, active.gesture.lastCell, {
          release: true,
        }),
      );
    }
    setMarker(null);
    finish();
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    const grid = readGrid();
    if (!grid || event.deltaY === 0) return;
    send(
      sgrMouse(
        event.deltaY < 0 ? MouseButton.wheelUp : MouseButton.wheelDown,
        cellAt(grid, event.clientX, event.clientY),
      ),
    );
  }

  return (
    <div
      ref={layerRef}
      data-testid="herdr-touch-layer"
      className="absolute inset-0 z-10"
      style={{
        touchAction: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onWheel={onWheel}
      onContextMenu={(event) => event.preventDefault()}
    >
      {marker && (
        <div
          aria-hidden="true"
          className={
            marker.kind === "hold"
              ? "pointer-events-none absolute border-2 border-accent-brand"
              : "pointer-events-none absolute bg-accent-brand/40"
          }
          style={{
            left: marker.left,
            top: marker.top,
            width: marker.width,
            height: marker.height,
          }}
        />
      )}
    </div>
  );
}
