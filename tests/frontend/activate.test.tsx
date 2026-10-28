import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;
afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const host = {
  id: "7",
  name: "box",
  ip: "10.0.0.5",
  port: 22,
  username: "jay",
  enableSsh: true,
  pluginSettings: { herdr: { enableHerdr: true } },
};

const snapshot = {
  version: "0.9.5",
  protocol: 22,
  focused_workspace_id: "w1",
  focused_tab_id: "w1:t1",
  focused_pane_id: "w1:p1",
  workspaces: [
    {
      workspace_id: "w1",
      label: "api",
      number: 1,
      focused: true,
      active_tab_id: "w1:t1",
      agent_status: "blocked",
      pane_count: 1,
      tab_count: 1,
    },
  ],
  tabs: [
    {
      tab_id: "w1:t1",
      workspace_id: "w1",
      label: "main",
      number: 1,
      focused: true,
      agent_status: "blocked",
      pane_count: 1,
    },
  ],
  panes: [
    {
      pane_id: "w1:p1",
      tab_id: "w1:t1",
      workspace_id: "w1",
      focused: true,
      agent: "claude",
      agent_status: "blocked",
    },
  ],
  layouts: [
    {
      tab_id: "w1:t1",
      workspace_id: "w1",
      area: { x: 0, y: 0, width: 80, height: 24 },
      focused_pane_id: "w1:p1",
      zoomed: false,
      panes: [
        {
          pane_id: "w1:p1",
          focused: true,
          rect: { x: 0, y: 0, width: 80, height: 24 },
        },
      ],
    },
  ],
  agents: [
    {
      pane_id: "w1:p1",
      tab_id: "w1:t1",
      workspace_id: "w1",
      focused: true,
      agent: "claude",
      agent_status: "blocked",
    },
  ],
};

/** Stands in for the SSH Terminal plugin's "terminal.view". */
function fakeTerminal() {
  const input: string[] = [];
  const props: Record<string, unknown>[] = [];
  let emit: (data: string) => void = () => {};
  function FakeTerminal(p: Record<string, unknown>) {
    props.push(p);
    useEffect(() => {
      const handle = {
        sendInput: (data: string) => input.push(data),
        subscribeOutput: (listener: (data: string) => void) => {
          emit = listener;
          return () => {};
        },
        focus: () => {},
        getApplicationCursorKeysMode: () => false,
      };
      (p.handleRef as (h: unknown) => void)(handle);
      return () => (p.handleRef as (h: unknown) => void)(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="fake-terminal" />;
  }
  return { FakeTerminal, input, props, output: (data: string) => emit(data) };
}

function api(post = vi.fn(async () => ({ data: { result: {} } }))) {
  return {
    get: vi.fn(async () => ({ data: { available: true, snapshot } })),
    post,
    put: vi.fn(),
    delete: vi.fn(),
  } as never;
}

describe("herdr activate", () => {
  it("registers the tab and the host button", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["herdr"]);
    expect(rendered.registered.hostActions()).toEqual([
      expect.objectContaining({ id: "herdr" }),
    ]);
    expect(rendered.registered.slot("terminal.toolbar")).toEqual([]);
  });

  it("offers the host button only where herdr is on and SSH is used", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    const ids = (h: unknown) =>
      rendered!.registered.hostActionsFor(h).map((a) => a.id);
    expect(ids(host)).toContain("herdr");
    expect(ids({ ...host, pluginSettings: {} })).toContain("herdr");
    expect(
      ids({ ...host, pluginSettings: { herdr: { enableHerdr: false } } }),
    ).not.toContain("herdr");
    expect(ids({ ...host, enableSsh: false })).not.toContain("herdr");
  });

  it("explains when the SSH Terminal plugin is missing", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales, api: api() });
    rendered.renderTab("herdr", {
      host,
      isVisible: true,
      tab: { id: "t", type: "herdr", label: "" },
    });
    expect(await screen.findByText(locales.tab.needsTerminal)).toBeTruthy();
  });

  it("launches herdr in the embedded terminal and drives it", async () => {
    const terminal = fakeTerminal();
    const post = vi.fn(async () => ({ data: { result: {} } }));
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(post),
    });
    rendered.app.registerComponent(
      "terminal.view",
      terminal.FakeTerminal as never,
    );
    rendered.renderTab("herdr", {
      host: {
        ...host,
        pluginSettings: { herdr: { enableHerdr: true, sessionName: "work" } },
      },
      isVisible: true,
      tab: { id: "t", type: "herdr", label: "" },
    });

    await screen.findByTestId("fake-terminal");
    expect(terminal.props.at(-1)).toMatchObject({
      executeCommand: "herdr --session work",
      hostConfig: expect.objectContaining({ id: "7", port: 22 }),
    });

    // The key bar is off on a desktop until asked for. Its Esc and herdr's
    // picker keys go into the terminal.
    expect(screen.queryByTestId("herdr-key-bar")).toBeNull();
    fireEvent.click(screen.getByLabelText(locales.toolbar.keysOn));
    fireEvent.click(await screen.findByLabelText(locales.keys.esc));
    fireEvent.click(screen.getByLabelText(locales.actions.workspacesHint));
    expect(terminal.input).toEqual(["\x1b", "\x02w"]);

    // Split right asks herdr's API about the focused pane.
    fireEvent.click(screen.getByLabelText(locales.actions.splitRight));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/hosts/7/actions", {
        action: "pane.split",
        params: { paneId: "w1:p1", direction: "right" },
      }),
    );
  });

  it("puts the touch layer over the terminal once herdr asks for the mouse", async () => {
    const terminal = fakeTerminal();
    rendered = await renderWithApp(plugin, { manifest, locales, api: api() });
    rendered.app.registerComponent(
      "terminal.view",
      terminal.FakeTerminal as never,
    );
    rendered.renderTab("herdr", {
      host,
      isVisible: true,
      tab: { id: "t", type: "herdr", label: "" },
    });
    await screen.findByTestId("fake-terminal");
    // Turn touch on by hand (jsdom has no coarse pointer).
    fireEvent.click(screen.getByLabelText(locales.toolbar.touchOn));
    expect(screen.queryByTestId("herdr-touch-layer")).toBeNull();
    terminal.output("\x1b[?1000h\x1b[?1006h");
    expect(await screen.findByTestId("herdr-touch-layer")).toBeTruthy();
    terminal.output("\x1b[?1000l");
    await waitFor(() =>
      expect(screen.queryByTestId("herdr-touch-layer")).toBeNull(),
    );
  });

  it("lists workspaces and agents waiting in the navigator", async () => {
    const terminal = fakeTerminal();
    const post = vi.fn(async () => ({ data: { result: {} } }));
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(post),
    });
    rendered.app.registerComponent(
      "terminal.view",
      terminal.FakeTerminal as never,
    );
    rendered.renderTab("herdr", {
      host,
      isVisible: true,
      tab: { id: "t", type: "herdr", label: "" },
    });
    fireEvent.click(await screen.findByLabelText(locales.toolbar.navigator));
    expect(await screen.findByText(locales.navigator.attention)).toBeTruthy();
    expect(screen.getByText("1. api")).toBeTruthy();
    expect(screen.getByTestId("herdr-pane-map")).toBeTruthy();

    fireEvent.change(
      screen.getByPlaceholderText(locales.navigator.promptPlaceholder),
      {
        target: { value: "run the tests" },
      },
    );
    fireEvent.click(screen.getByText(locales.navigator.prompt));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/hosts/7/actions", {
        action: "agent.prompt",
        params: { paneId: "w1:p1", text: "run the tests" },
      }),
    );
  });
});
