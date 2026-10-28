// Runs the real routes against a real herdr, with "SSH" replaced by a local
// `sh -s`. Opt in with HERDR_INTEGRATION=1; it starts and deletes its own
// named session and never touches your others.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers.js";

const SESSION = `termix-it-${process.pid}`;
const enabled = process.env.HERDR_INTEGRATION === "1";

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("HERDR_")),
);

/** An ssh2 client double whose exec runs the command on this machine. */
const localClient = {
  exec(
    command: string,
    callback: (err: Error | undefined, stream: unknown) => void,
  ) {
    const child = spawn("sh", ["-c", command], { env });
    const stream = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      end: (data?: string) => void;
      close: () => void;
    };
    stream.stderr = new EventEmitter();
    child.stdout.on("data", (d) => stream.emit("data", d));
    child.stderr.on("data", (d) => stream.stderr.emit("data", d));
    child.on("close", (code) => stream.emit("close", code));
    stream.end = (data) => child.stdin.end(data);
    stream.close = () => child.kill();
    callback(undefined, stream);
  },
};

let herdrServer: ChildProcess | null = null;
let server: TestServer;

describe.skipIf(!enabled)("against a real herdr", () => {
  beforeAll(async () => {
    herdrServer = spawn("herdr", ["--session", SESSION, "server"], {
      env,
      stdio: "ignore",
    });
    for (let i = 0; i < 50; i++) {
      const probe = spawnSync(
        "herdr",
        ["--session", SESSION, "api", "snapshot"],
        { env },
      );
      if (probe.status === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    server = await startServer({
      sshClient: localClient,
      hostSettings: { sessionName: SESSION },
    });
  }, 20_000);

  afterAll(async () => {
    await server?.close();
    spawnSync("herdr", ["session", "stop", SESSION], { env });
    spawnSync("herdr", ["session", "delete", SESSION], { env });
    herdrServer?.kill();
  });

  async function state() {
    const res = await server.request("GET", "/hosts/7/state");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    return res.body.snapshot;
  }

  async function act(action: string, params: Record<string, unknown> = {}) {
    const res = await server.request("POST", "/hosts/7/actions", {
      action,
      params,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result;
  }

  it("creates, splits, focuses, types into, reads and closes", async () => {
    await act("workspace.create", { label: "it's here" });
    let snap = await state();
    expect(snap.workspaces.map((w: { label: string }) => w.label)).toContain(
      "it's here",
    );
    const workspaceId = snap.focused_workspace_id;
    const firstPane = snap.focused_pane_id;

    await act("pane.split", { paneId: firstPane, direction: "right" });
    snap = await state();
    const layout = snap.layouts.find(
      (l: { tab_id: string }) => l.tab_id === snap.focused_tab_id,
    );
    expect(layout.panes).toHaveLength(2);
    expect(snap.focused_pane_id).not.toBe(firstPane);

    // Focus by id goes through the socket API.
    await act("pane.focus", { paneId: firstPane });
    snap = await state();
    expect(snap.focused_pane_id).toBe(firstPane);

    await act("pane.run", {
      paneId: firstPane,
      command: "echo 'marker'\"$((6*7))\"",
    });
    let text = "";
    for (let i = 0; i < 40 && !text.includes("marker42"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const res = await server.request(
        "GET",
        `/hosts/7/panes/${firstPane}/read?lines=20`,
      );
      text = res.body.text;
    }
    expect(text).toContain("marker42");

    await act("tab.create", { workspaceId });
    snap = await state();
    expect(
      snap.tabs.filter(
        (t: { workspace_id: string }) => t.workspace_id === workspaceId,
      ),
    ).toHaveLength(2);

    await act("workspace.rename", { workspaceId, label: "renamed" });
    await act("workspace.close", { workspaceId });
    snap = await state();
    expect(
      snap.workspaces.find(
        (w: { workspace_id: string }) => w.workspace_id === workspaceId,
      ),
    ).toBeUndefined();
  }, 30_000);

  it("explains an unknown pane", async () => {
    const res = await server.request("POST", "/hosts/7/actions", {
      action: "pane.zoom",
      params: { paneId: "w999:p9" },
    });
    expect(res.status).toBe(422);
  });
});
