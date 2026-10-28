import type { Request, Response, Router } from "express";
import type {
  PluginContext,
  PluginHostSummary,
} from "@termix-ssh/plugin-sdk/backend";
import {
  HOST_SETTINGS,
  isPaneId,
  normalizeBinary,
  normalizeSession,
  type HerdrErrorCode,
  type HerdrSnapshot,
  type HerdrState,
} from "../shared/herdr.js";
import { ActionError, buildAction, readLines } from "./actions.js";
import {
  HerdrCommandError,
  SOCKET_UNAVAILABLE,
  checkHerdrResult,
  buildScript,
  buildSocketScript,
  parseHerdrResult,
  runScript,
  type SshClientLike,
} from "./remote.js";

const POOL = "herdr";

interface HerdrTarget {
  host: PluginHostSummary;
  binary: string;
  session: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function classify(err: unknown): { code: HerdrErrorCode; error: string } {
  if (err instanceof HerdrCommandError) {
    return { code: err.code, error: err.message };
  }
  return { code: "HOST_UNREACHABLE", error: errorMessage(err) };
}

/**
 * Resolves the host for the acting user and reads how to reach herdr on it.
 * Sends the error response and returns null when it can't be used.
 */
async function requireTarget(
  ctx: PluginContext,
  req: Request,
  res: Response,
): Promise<HerdrTarget | null> {
  const hostId = Number(req.params.hostId);
  if (!Number.isInteger(hostId) || hostId <= 0) {
    res.status(400).json({ error: "Invalid host id" });
    return null;
  }
  const host = await ctx.hosts.get(hostId);
  if (!host) {
    res.status(404).json({ error: "Host not found" });
    return null;
  }
  // Hiding the button is not enough: the API refuses too.
  const enabled = await ctx.settings.getHost<boolean>(
    hostId,
    HOST_SETTINGS.enabled,
  );
  if (enabled === false) {
    res.status(403).json({ error: "Herdr is turned off for this host" });
    return null;
  }
  const binary = normalizeBinary(
    await ctx.settings.getHost<string>(hostId, HOST_SETTINGS.binary),
  );
  const session = normalizeSession(
    await ctx.settings.getHost<string>(hostId, HOST_SETTINGS.session),
  );
  if (binary === null || session === null) {
    res.status(400).json({
      error:
        "The herdr path or session name in this host's settings is invalid",
    });
    return null;
  }
  return { host, binary, session };
}

function withClient<T>(
  ctx: PluginContext,
  target: HerdrTarget,
  fn: (client: SshClientLike) => Promise<T>,
): Promise<T> {
  return ctx.ssh.withConnection<T, SshClientLike>(
    target.host.id,
    { pool: POOL, purpose: "herdr", overrides: { readyTimeout: 60_000 } },
    fn,
  );
}

async function runHerdr(
  client: SshClientLike,
  target: HerdrTarget,
  args: string[],
): Promise<unknown> {
  return parseHerdrResult(
    await runScript(client, buildScript(target.binary, target.session, args)),
  );
}

async function readSnapshot(
  client: SshClientLike,
  target: HerdrTarget,
): Promise<HerdrSnapshot> {
  const result = (await runHerdr(client, target, ["api", "snapshot"])) as {
    snapshot?: HerdrSnapshot;
  };
  if (!result?.snapshot || !Array.isArray(result.snapshot.workspaces)) {
    throw new HerdrCommandError(
      "herdr returned an unexpected snapshot",
      "HERDR_ERROR",
    );
  }
  return result.snapshot;
}

/**
 * The CLI cannot focus a pane by id, so ask the socket API. Without python3
 * on the host, fall back to the pane's agent or its tab.
 */
async function focusPane(
  client: SshClientLike,
  target: HerdrTarget,
  paneId: string,
): Promise<unknown> {
  const result = await runScript(
    client,
    buildSocketScript(target.binary, target.session, "pane.focus", {
      pane_id: paneId,
    }),
  );
  if (result.code === 0) {
    const response = JSON.parse(result.stdout || "{}") as {
      result?: unknown;
      error?: { code?: string; message?: string };
    };
    if (response.error) {
      throw new HerdrCommandError(
        response.error.message ?? "herdr refused to focus the pane",
        "HERDR_ERROR",
        response.error.code,
      );
    }
    return response.result ?? {};
  }
  if (result.code !== SOCKET_UNAVAILABLE) return parseHerdrResult(result);

  const snapshot = await readSnapshot(client, target);
  const pane = snapshot.panes.find((entry) => entry.pane_id === paneId);
  if (!pane) {
    throw new HerdrCommandError(
      "pane not found",
      "HERDR_ERROR",
      "pane_not_found",
    );
  }
  if (pane.agent) return runHerdr(client, target, ["agent", "focus", paneId]);
  return runHerdr(client, target, ["tab", "focus", pane.tab_id]);
}

function sendActionError(res: Response, err: unknown): void {
  if (err instanceof ActionError) {
    res.status(400).json({ error: err.message });
    return;
  }
  const { code, error } = classify(err);
  // Only 4xx: a herdr refusal or a host that is down is not a plugin fault,
  // and must not count against the plugin's error budget.
  const status =
    code === "HERDR_ERROR" ? 422 : code === "HOST_UNREACHABLE" ? 424 : 409;
  res.status(status).json({
    error,
    code,
    ...(err instanceof HerdrCommandError && err.herdrCode
      ? { herdrCode: err.herdrCode }
      : {}),
  });
}

export function registerRoutes(router: Router, ctx: PluginContext): void {
  router.use(ctx.rbac.require("use") as never);

  /**
   * @openapi
   * /plugin-api/herdr/hosts/{hostId}/state:
   *   get:
   *     summary: Read herdr's workspaces, tabs, panes and agents on a host
   *     tags:
   *       - Herdr
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: >-
   *           The herdr snapshot as `{ available: true, snapshot }`, or
   *           `{ available: false, code, error }` when herdr is not installed,
   *           not running or the host can't be reached
   *       400:
   *         description: Invalid host id or herdr host settings
   *       403:
   *         description: Herdr is turned off for this host
   *       404:
   *         description: The host does not exist or the user can't see it
   */
  router.get("/hosts/:hostId/state", async (req: Request, res: Response) => {
    const target = await requireTarget(ctx, req, res);
    if (!target) return;
    let state: HerdrState;
    try {
      const snapshot = await withClient(ctx, target, (client) =>
        readSnapshot(client, target),
      );
      state = { available: true, snapshot };
    } catch (err) {
      state = { available: false, ...classify(err) };
    }
    res.json(state);
  });

  /**
   * @openapi
   * /plugin-api/herdr/hosts/{hostId}/actions:
   *   post:
   *     summary: Run one herdr command on a host
   *     description: >-
   *       Focus, create, rename and close workspaces and tabs; focus, split,
   *       zoom and close panes; send text or keys to a pane; prompt an agent.
   *       Only the listed actions are accepted and every id is validated.
   *     tags:
   *       - Herdr
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - action
   *             properties:
   *               action:
   *                 type: string
   *                 enum:
   *                   - workspace.focus
   *                   - workspace.create
   *                   - workspace.rename
   *                   - workspace.close
   *                   - tab.focus
   *                   - tab.create
   *                   - tab.rename
   *                   - tab.close
   *                   - pane.focus
   *                   - pane.split
   *                   - pane.zoom
   *                   - pane.close
   *                   - pane.sendText
   *                   - pane.sendKeys
   *                   - pane.run
   *                   - agent.prompt
   *               params:
   *                 type: object
   *     responses:
   *       200:
   *         description: herdr's result for the command
   *       400:
   *         description: Unknown action or invalid parameters
   *       403:
   *         description: Herdr is turned off for this host
   *       404:
   *         description: The host does not exist or the user can't see it
   *       409:
   *         description: herdr is not installed or not running on the host
   *       422:
   *         description: herdr refused the command
   *       424:
   *         description: The host could not be reached
   */
  router.post("/hosts/:hostId/actions", async (req: Request, res: Response) => {
    let action;
    try {
      action = buildAction(req.body?.action, req.body?.params);
    } catch (err) {
      sendActionError(res, err);
      return;
    }
    const target = await requireTarget(ctx, req, res);
    if (!target) return;
    try {
      const result = await withClient(ctx, target, (client) =>
        action.kind === "focusPane"
          ? focusPane(client, target, action.paneId)
          : runHerdr(client, target, action.args),
      );
      res.json({ result });
    } catch (err) {
      sendActionError(res, err);
    }
  });

  /**
   * @openapi
   * /plugin-api/herdr/hosts/{hostId}/panes/{paneId}/read:
   *   get:
   *     summary: Read the recent output of a herdr pane as text
   *     tags:
   *       - Herdr
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: paneId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: lines
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 1000
   *     responses:
   *       200:
   *         description: The pane's recent output
   *       400:
   *         description: Invalid pane id
   *       409:
   *         description: herdr is not installed or not running on the host
   *       422:
   *         description: herdr refused the read
   *       424:
   *         description: The host could not be reached
   */
  router.get(
    "/hosts/:hostId/panes/:paneId/read",
    async (req: Request, res: Response) => {
      const paneId = String(req.params.paneId);
      if (!isPaneId(paneId)) {
        res.status(400).json({ error: "Invalid pane id" });
        return;
      }
      const target = await requireTarget(ctx, req, res);
      if (!target) return;
      try {
        // pane read prints the text itself, not JSON.
        const result = await withClient(ctx, target, (client) =>
          runScript(
            client,
            buildScript(target.binary, target.session, [
              "pane",
              "read",
              paneId,
              "--source",
              "recent-unwrapped",
              "--lines",
              String(readLines(req.query.lines)),
            ]),
          ),
        );
        checkHerdrResult(result);
        res.json({ text: result.stdout });
      } catch (err) {
        sendActionError(res, err);
      }
    },
  );
}
