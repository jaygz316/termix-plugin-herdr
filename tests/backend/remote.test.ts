import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HerdrCommandError,
  SOCKET_UNAVAILABLE,
  buildScript,
  buildSocketScript,
  parseHerdrResult,
  shQuote,
} from "../../src/backend/remote.js";

// A fake herdr that prints each argument NUL-terminated, so a test can check
// exactly what argv the script built.
let home: string;
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "herdr-plugin-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const fake = join(home, ".local", "bin", "herdr");
  writeFileSync(
    fake,
    '#!/bin/sh\nfor a in "$@"; do printf \'%s\\0\' "$a"; done\n',
  );
  chmodSync(fake, 0o755);
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

function runSh(script: string) {
  const result = spawnSync("sh", ["-s"], {
    input: script,
    env: { HOME: home, PATH: "/usr/bin:/bin" },
    encoding: "utf8",
  });
  return {
    code: result.status,
    args: result.stdout.split("\0").slice(0, -1),
    stderr: result.stderr,
  };
}

describe("shQuote", () => {
  it("keeps any text as one sh word", () => {
    for (const value of [
      "plain",
      "it's",
      "$(rm -rf /)",
      "`x`",
      "a\nb",
      "",
      "\\'",
    ]) {
      const out = spawnSync("sh", ["-c", `printf '%s' ${shQuote(value)}`], {
        encoding: "utf8",
      }).stdout;
      expect(out).toBe(value);
    }
  });
});

describe("buildScript", () => {
  it("finds herdr in ~/.local/bin without a login profile", () => {
    const run = runSh(buildScript("herdr", "", ["api", "snapshot"]));
    expect(run.code).toBe(0);
    expect(run.args).toEqual(["api", "snapshot"]);
  });

  it("passes hostile text through as single arguments", () => {
    const text = `hi'; touch /tmp/pwned; echo "$(id)" \`id\`\nline2`;
    const run = runSh(
      buildScript("herdr", "", ["pane", "send-text", "w1:p1", text]),
    );
    expect(run.args).toEqual(["pane", "send-text", "w1:p1", text]);
  });

  it("adds the session before the command", () => {
    const run = runSh(buildScript("herdr", "work", ["tab", "list"]));
    expect(run.args).toEqual(["--session", "work", "tab", "list"]);
  });

  it("expands a ~/ path to the home folder", () => {
    const run = runSh(
      buildScript("~/.local/bin/herdr", "", ["api", "snapshot"]),
    );
    expect(run.code).toBe(0);
    expect(run.args).toEqual(["api", "snapshot"]);
  });

  it("reports a missing binary with exit 127", () => {
    const run = runSh(buildScript("no-such-herdr", "", ["api", "snapshot"]));
    expect(run.code).toBe(127);
    expect(() =>
      parseHerdrResult({ stdout: "", stderr: run.stderr, code: run.code }),
    ).toThrow(expect.objectContaining({ code: "HERDR_NOT_INSTALLED" }));
  });
});

describe("buildSocketScript", () => {
  it("gives up with SOCKET_UNAVAILABLE when herdr reports no socket", () => {
    // The fake herdr prints its args, not "socket: <path>".
    const run = runSh(
      buildSocketScript("herdr", "", "pane.focus", { pane_id: "w1:p1" }),
    );
    expect(run.code).toBe(SOCKET_UNAVAILABLE);
  });
});

describe("parseHerdrResult", () => {
  it("returns the result of a JSON reply", () => {
    expect(
      parseHerdrResult({
        stdout: '{"id":"x","result":{"ok":true}}',
        stderr: "",
        code: 0,
      }),
    ).toEqual({ ok: true });
  });

  it("treats empty output from a successful command as an empty result", () => {
    expect(parseHerdrResult({ stdout: "", stderr: "", code: 0 })).toEqual({});
    expect(parseHerdrResult({ stdout: "done\n", stderr: "", code: 0 })).toEqual(
      {
        output: "done",
      },
    );
  });

  it("classifies herdr's server_not_running error", () => {
    const stderr =
      '{"id":"cli:api:snapshot","error":{"code":"server_not_running","message":"no herdr server is running"}}';
    try {
      parseHerdrResult({ stdout: "", stderr, code: 1 });
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HerdrCommandError);
      expect((err as HerdrCommandError).code).toBe("HERDR_NOT_RUNNING");
      expect((err as HerdrCommandError).message).toBe(
        "no herdr server is running",
      );
    }
  });

  it("keeps herdr's own error code for other refusals", () => {
    const stderr =
      '{"error":{"code":"pane_not_found","message":"pane not found"},"id":"x"}';
    try {
      parseHerdrResult({ stdout: "", stderr, code: 1 });
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as HerdrCommandError).code).toBe("HERDR_ERROR");
      expect((err as HerdrCommandError).herdrCode).toBe("pane_not_found");
    }
  });
});
