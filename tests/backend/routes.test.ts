import { afterEach, describe, expect, it } from "vitest";
import {
  SNAPSHOT,
  fakeSshClient,
  snapshotReply,
  startServer,
  type TestServer,
} from "./helpers.js";

let server: TestServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe("GET /hosts/:hostId/state", () => {
  it("returns herdr's snapshot", async () => {
    const ssh = fakeSshClient(() => snapshotReply());
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request("GET", "/hosts/7/state");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, snapshot: SNAPSHOT });
    expect(ssh.commands).toEqual(["sh -s"]);
    expect(ssh.scripts[0]).toContain("exec \"$H\" 'api' 'snapshot'");
  });

  it("uses the host's binary and session settings", async () => {
    const ssh = fakeSshClient(() => snapshotReply());
    server = await startServer({
      sshClient: ssh.client,
      hostSettings: { binaryPath: "/opt/herdr/bin/herdr", sessionName: "work" },
    });
    await server.request("GET", "/hosts/7/state");
    expect(ssh.scripts[0]).toContain("H='/opt/herdr/bin/herdr'");
    expect(ssh.scripts[0]).toContain("--session 'work' 'api' 'snapshot'");
  });

  it("reports herdr not installed as unavailable, not as a server error", async () => {
    const ssh = fakeSshClient(() => ({
      code: 127,
      err: "__TERMIX_HERDR_NOT_FOUND__",
    }));
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request("GET", "/hosts/7/state");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      available: false,
      code: "HERDR_NOT_INSTALLED",
    });
  });

  it("reports a stopped herdr server", async () => {
    const ssh = fakeSshClient(() => ({
      code: 1,
      err: '{"id":"x","error":{"code":"server_not_running","message":"no herdr server is running"}}',
    }));
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request("GET", "/hosts/7/state");
    expect(res.body).toMatchObject({
      available: false,
      code: "HERDR_NOT_RUNNING",
    });
  });

  it("needs the use permission", async () => {
    server = await startServer({ permissions: [] });
    const res = await server.request("GET", "/hosts/7/state");
    expect(res.status).toBe(403);
  });

  it("refuses a host with herdr turned off", async () => {
    const ssh = fakeSshClient(() => snapshotReply());
    server = await startServer({
      sshClient: ssh.client,
      hostSettings: { enableHerdr: false },
    });
    const res = await server.request("GET", "/hosts/7/state");
    expect(res.status).toBe(403);
    expect(ssh.scripts).toEqual([]);
  });

  it("refuses an unknown host and a bad id", async () => {
    server = await startServer();
    expect((await server.request("GET", "/hosts/99/state")).status).toBe(404);
    expect((await server.request("GET", "/hosts/abc/state")).status).toBe(400);
  });

  it("refuses an unsafe binary path", async () => {
    const ssh = fakeSshClient(() => snapshotReply());
    server = await startServer({
      sshClient: ssh.client,
      hostSettings: { binaryPath: "herdr; rm -rf ~" },
    });
    const res = await server.request("GET", "/hosts/7/state");
    expect(res.status).toBe(400);
    expect(ssh.scripts).toEqual([]);
  });
});

describe("POST /hosts/:hostId/actions", () => {
  it("runs a whitelisted command with quoted arguments", async () => {
    const ssh = fakeSshClient(() => ({
      out: '{"id":"x","result":{"type":"ok"}}',
    }));
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request("POST", "/hosts/7/actions", {
      action: "agent.prompt",
      params: { paneId: "w1:p1", text: "fix it'; reboot" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: { type: "ok" } });
    expect(ssh.scripts[0]).toContain(
      `'agent' 'prompt' 'w1:p1' 'fix it'\\''; reboot'`,
    );
  });

  it("rejects an unknown action before connecting", async () => {
    const ssh = fakeSshClient(() => ({}));
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request("POST", "/hosts/7/actions", {
      action: "shell",
    });
    expect(res.status).toBe(400);
    expect(ssh.scripts).toEqual([]);
  });

  it("passes herdr's refusal on as a 422", async () => {
    const ssh = fakeSshClient(() => ({
      code: 1,
      err: '{"error":{"code":"pane_not_found","message":"pane not found"},"id":"x"}',
    }));
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request("POST", "/hosts/7/actions", {
      action: "pane.zoom",
      params: { paneId: "w1:p9" },
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "pane not found",
      herdrCode: "pane_not_found",
    });
  });

  it("focuses a pane through herdr's socket", async () => {
    const ssh = fakeSshClient(() => ({
      out: '{"id":"termix","result":{"type":"pane_info"}}\n',
    }));
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request("POST", "/hosts/7/actions", {
      action: "pane.focus",
      params: { paneId: "w1:p2" },
    });
    expect(res.status).toBe(200);
    expect(ssh.scripts).toHaveLength(1);
    expect(ssh.scripts[0]).toContain("python3");
    expect(ssh.scripts[0]).toContain(
      '"method":"pane.focus","params":{"pane_id":"w1:p2"}',
    );
  });

  it("falls back to the pane's tab without python3", async () => {
    const ssh = fakeSshClient((script) => {
      if (script.includes("python3")) return { code: 3 };
      if (script.includes("'api' 'snapshot'")) return snapshotReply();
      return { out: '{"id":"x","result":{}}' };
    });
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request("POST", "/hosts/7/actions", {
      action: "pane.focus",
      params: { paneId: "w1:p2" },
    });
    expect(res.status).toBe(200);
    expect(ssh.scripts.at(-1)).toContain("'tab' 'focus' 'w1:t1'");
  });

  it("falls back to agent focus for an agent pane", async () => {
    const ssh = fakeSshClient((script) => {
      if (script.includes("python3")) return { code: 3 };
      if (script.includes("'api' 'snapshot'")) return snapshotReply();
      return { out: '{"id":"x","result":{}}' };
    });
    server = await startServer({ sshClient: ssh.client });
    await server.request("POST", "/hosts/7/actions", {
      action: "pane.focus",
      params: { paneId: "w1:p1" },
    });
    expect(ssh.scripts.at(-1)).toContain("'agent' 'focus' 'w1:p1'");
  });
});

describe("GET /hosts/:hostId/panes/:paneId/read", () => {
  it("returns the pane's text", async () => {
    const ssh = fakeSshClient(() => ({ out: "$ make\nok\n" }));
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request(
      "GET",
      "/hosts/7/panes/w1:p1/read?lines=5",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: "$ make\nok\n" });
    expect(ssh.scripts[0]).toContain(
      "'pane' 'read' 'w1:p1' '--source' 'recent-unwrapped' '--lines' '5'",
    );
  });

  it("refuses a bad pane id", async () => {
    server = await startServer();
    const res = await server.request("GET", "/hosts/7/panes/nope/read");
    expect(res.status).toBe(400);
  });
});

describe("GET /hosts/:hostId/sessions", () => {
  it("lists sessions on the host and supports session overrides", async () => {
    const ssh = fakeSshClient(() => ({
      out: JSON.stringify({
        sessions: [
          { name: "default", running: true, attached: 1 },
          { name: "work", running: true, attached: 2 },
        ],
      }),
    }));
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request("GET", "/hosts/7/sessions?session=work");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      activeSession: "work",
      sessions: [
        { name: "default", running: true, attached: 1 },
        { name: "work", running: true, attached: 2 },
      ],
    });
    expect(ssh.scripts[0]).toContain("exec \"$H\" 'session' 'list' '--json'");
  });

  it("needs the use permission", async () => {
    server = await startServer({ permissions: [] });
    const res = await server.request("GET", "/hosts/7/sessions");
    expect(res.status).toBe(403);
  });

  it("refuses an invalid session override", async () => {
    server = await startServer();
    const res = await server.request(
      "GET",
      "/hosts/7/state?session=bad;session",
    );
    expect(res.status).toBe(400);
  });
});

describe("herdr-core (hc) + herdr-app compatibility", () => {
  const hcStateDump = [
    "__TERMIX_HC_STATE__",
    JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      result: { version: "0.1.19", core: { id: "c1", name: "fedora" } },
    }),
    JSON.stringify({
      id: 2,
      jsonrpc: "2.0",
      result: {
        machines: [
          {
            name: "ucloud",
            target: "ucloud",
            state: "connected",
            version: "0.1.19",
          },
        ],
        terminals: [
          {
            address: "t5",
            state: "live",
            cwd: "/home/jay",
            foreground: {
              name: "claude",
              argv: ["claude"],
              cwd: "/home/jay/projects/money",
              pid: 100,
            },
            keep: true,
            labels: {
              "herdr.space": "sp903df98277bdbccbfbf63cdea22046d6",
              "herdr.tab": "tb687ff508b103c6e1ee70bb55917be69a",
              "herdr.seen": "12",
              "herdr.pinned": "true",
              where: "money / money",
            },
            reported: true,
            status: {
              app: "claude-code",
              msg: "awaiting review",
              state: "done",
            },
            title: "Inbox",
            turn: 13,
          },
          {
            address: "ucloud/t4",
            state: "live",
            cwd: "/home/jay/projects/gt",
            foreground: {
              name: "claude",
              argv: ["claude"],
              cwd: "/home/jay/projects/gt",
              pid: 200,
            },
            keep: true,
            labels: {
              "herdr.space": "sp271073d0a9a1526e53b0f1853092deb8",
              "herdr.tab": "tb4300cf870720dedae63f021cfcf29205",
              where: "gt / main",
            },
            reported: true,
            status: {
              app: "claude-code",
              msg: "Allow tool?",
              state: "blocked",
            },
            title: "Triage",
            turn: 4,
          },
        ],
      },
    }),
    JSON.stringify({
      id: 3,
      jsonrpc: "2.0",
      result: {
        version: 24,
        value: {
          spaces: [
            {
              id: "sp903df98277bdbccbfbf63cdea22046d6",
              name: "",
              folder: "/home/jay",
              tabs: [
                {
                  id: "tb687ff508b103c6e1ee70bb55917be69a",
                  name: "money",
                  root: {
                    id: "tb687ff508b103c6e1ee70bb55917be69a",
                    type: "row",
                    children: [
                      {
                        id: "pf7b33a07abda79c075e93c65579ee5ee",
                        type: "block",
                        size: { weight: 1 },
                        content: { terminal: "t5" },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    }),
    "__TERMIX_HC_VIEW__",
    JSON.stringify({
      active: "sp903df98277bdbccbfbf63cdea22046d6",
      spaces: {
        sp903df98277bdbccbfbf63cdea22046d6:
          "tb687ff508b103c6e1ee70bb55917be69a",
      },
      tabs: {
        tb687ff508b103c6e1ee70bb55917be69a: {
          focused: "pf7b33a07abda79c075e93c65579ee5ee",
          zoomed: null,
        },
      },
    }),
  ].join("\n");

  it("synthesizes a snapshot from hc connect and herdr-app docs", async () => {
    const ssh = fakeSshClient(() => ({ out: hcStateDump }));
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request("GET", "/hosts/7/state");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    const snap = res.body.snapshot;
    expect(snap.runtime).toBe("hc");
    expect(snap.version).toBe("0.1.19");
    expect(snap.focused_workspace_id).toBe(
      "sp903df98277bdbccbfbf63cdea22046d6",
    );
    expect(snap.focused_pane_id).toBe("pf7b33a07abda79c075e93c65579ee5ee");
    expect(snap.focused_terminal_id).toBe("t5");
    expect(snap.workspaces).toHaveLength(2);
    expect(snap.workspaces[0]).toMatchObject({
      workspace_id: "sp903df98277bdbccbfbf63cdea22046d6",
      label: "money",
      agent_status: "done",
    });
    expect(snap.workspaces[1]).toMatchObject({
      workspace_id: "ucloud/sp271073d0a9a1526e53b0f1853092deb8",
      label: "ucloud: gt",
      machine: "ucloud",
      agent_status: "blocked",
    });
    expect(snap.agents).toHaveLength(2);
    expect(snap.agents[0]).toMatchObject({
      pane_id: "pf7b33a07abda79c075e93c65579ee5ee",
      terminal_id: "t5",
      agent: "claude",
      agent_status: "done",
      status_msg: "awaiting review",
      pinned: true,
      unseen: true,
    });
    expect(snap.machines).toEqual([
      {
        name: "ucloud",
        target: "ucloud",
        state: "connected",
        version: "0.1.19",
      },
    ]);
  });

  it("reads hc terminal output and runs hc actions", async () => {
    const ssh = fakeSshClient((script) => {
      if (script.includes("__TERMIX_HC_STATE__")) return { out: hcStateDump };
      if (script.includes("'read' '--lines' '10' 't5'")) {
        return { out: "hello from hc\n" };
      }
      return { out: '{"ok":true}\n' };
    });
    server = await startServer({ sshClient: ssh.client });

    const readRes = await server.request(
      "GET",
      "/hosts/7/panes/pf7b33a07abda79c075e93c65579ee5ee/read?lines=10",
    );
    expect(readRes.status).toBe(200);
    expect(readRes.body).toEqual({ text: "hello from hc\n" });

    const pinRes = await server.request("POST", "/hosts/7/actions", {
      action: "agent.pin",
      params: { paneId: "ucloud/t4", pinned: true },
    });
    expect(pinRes.status).toBe(200);
    expect(ssh.scripts.at(-1)).toContain(
      `'label' '--json' 'ucloud/t4' 'herdr.pinned=true'`,
    );

    const intRes = await server.request("POST", "/hosts/7/actions", {
      action: "pane.interrupt",
      params: { paneId: "ucloud/t4" },
    });
    expect(intRes.status).toBe(200);
    expect(ssh.scripts.at(-1)).toContain(`'interrupt' '--json' 'ucloud/t4'`);
  });

  it("maps hc's blocked refusal to agent_blocked", async () => {
    const ssh = fakeSshClient(() => ({
      code: 9,
      err: '{"error":{"code":-32009,"data":{"kind":"blocked"},"message":"terminal is blocked"}}',
    }));
    server = await startServer({ sshClient: ssh.client });
    const res = await server.request("POST", "/hosts/7/actions", {
      action: "agent.prompt",
      params: { paneId: "ucloud/t4", text: "continue" },
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "terminal is blocked",
      herdrCode: "agent_blocked",
    });
  });
});
