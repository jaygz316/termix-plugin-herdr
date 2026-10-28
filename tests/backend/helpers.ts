import http from "node:http";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import express, { type Router } from "express";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginHostSummary } from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activate } from "../../src/backend/index.js";

export const manifest = manifestJson as unknown as PluginManifest;

export function host(
  overrides: Partial<PluginHostSummary> = {},
): PluginHostSummary {
  return {
    id: 7,
    userId: "user-1",
    name: "box",
    ip: "10.0.0.5",
    port: 22,
    username: "jay",
    tags: null,
    folder: null,
    authType: "password",
    ...overrides,
  };
}

export interface Reply {
  out?: string;
  err?: string;
  code?: number;
}

/**
 * An ssh2 client double. Each exec gets its script on stdin, as the plugin
 * sends it; `respond` sees the script and answers like the host would.
 */
export function fakeSshClient(respond: (script: string) => Reply) {
  const scripts: string[] = [];
  const commands: string[] = [];
  const client = {
    exec(
      command: string,
      callback: (err: Error | undefined, stream: unknown) => void,
    ) {
      commands.push(command);
      const stream = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        end: (data?: string) => void;
        close: () => void;
      };
      stream.stderr = new EventEmitter();
      stream.close = () => stream.emit("close", null);
      stream.end = (script?: string) => {
        scripts.push(script ?? "");
        const reply = respond(script ?? "");
        setImmediate(() => {
          if (reply.out) stream.emit("data", Buffer.from(reply.out));
          if (reply.err) stream.stderr.emit("data", Buffer.from(reply.err));
          stream.emit("close", reply.code ?? 0);
        });
      };
      callback(undefined, stream);
    },
  };
  return { client, scripts, commands };
}

export interface TestServer {
  mock: MockPluginContext;
  request: (
    method: string,
    path: string,
    body?: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

export async function startServer(
  options: {
    permissions?: string[];
    hosts?: PluginHostSummary[];
    sshClient?: unknown;
    hostSettings?: Record<string, unknown>;
  } = {},
): Promise<TestServer> {
  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    router: () => (router = express.Router()),
    permissions: options.permissions ?? ["herdr.use"],
    hosts: options.hosts ?? [host()],
    sshClient: options.sshClient,
  });
  for (const [key, value] of Object.entries(options.hostSettings ?? {})) {
    await mock.ctx.settings.setHost(7, key, value);
  }
  await activate(mock.ctx);

  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => {
    mock.setActor("user-1");
    next();
  });
  app.use((req, res, next) => router!(req, res, next));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    mock,
    async request(method, path, body) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const SNAPSHOT = {
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
      pane_count: 2,
      tab_count: 1,
    },
  ],
  tabs: [
    {
      tab_id: "w1:t1",
      workspace_id: "w1",
      label: "1",
      number: 1,
      focused: true,
      agent_status: "blocked",
      pane_count: 2,
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
      cwd: "/home/jay/api",
    },
    {
      pane_id: "w1:p2",
      tab_id: "w1:t1",
      workspace_id: "w1",
      focused: false,
      agent_status: "unknown",
      cwd: "/home/jay/api",
    },
  ],
  layouts: [
    {
      tab_id: "w1:t1",
      workspace_id: "w1",
      area: { x: 0, y: 0, width: 100, height: 40 },
      focused_pane_id: "w1:p1",
      zoomed: false,
      panes: [
        {
          pane_id: "w1:p1",
          focused: true,
          rect: { x: 0, y: 0, width: 50, height: 40 },
        },
        {
          pane_id: "w1:p2",
          focused: false,
          rect: { x: 50, y: 0, width: 50, height: 40 },
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

export function snapshotReply(): Reply {
  return {
    out: JSON.stringify({
      id: "cli:api:snapshot",
      result: { snapshot: SNAPSHOT },
    }),
  };
}
