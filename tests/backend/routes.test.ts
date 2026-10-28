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
