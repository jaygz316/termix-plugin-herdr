import { StringDecoder } from "node:string_decoder";
import type { HerdrErrorCode } from "../shared/herdr.js";

/** The parts of an ssh2 Client this plugin uses. */
export interface SshClientLike {
  exec: (
    command: string,
    callback: (err: Error | undefined, stream: SshStreamLike) => void,
  ) => unknown;
}

export interface SshStreamLike {
  on: (event: string, listener: (...args: any[]) => void) => unknown;
  stderr: { on: (event: string, listener: (data: Buffer) => void) => unknown };
  end: (data?: string) => unknown;
  close?: () => unknown;
}

export interface ScriptResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Marks "the binary is not on this host" on stderr, see buildScript. */
export const NOT_FOUND_MARK = "__TERMIX_HERDR_NOT_FOUND__";
/** Exit code of the socket request script when it cannot reach the socket. */
export const SOCKET_UNAVAILABLE = 3;

const MAX_OUTPUT = 4 * 1024 * 1024;

/** Quotes one argument for POSIX sh. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Non-interactive SSH sessions often skip the profile that puts ~/.local/bin
// (herdr's install location) on PATH, so add the usual places.
const PREAMBLE = [
  'PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"',
  "export PATH",
  // Never let a herdr pane's caller context leak into our commands.
  "unset HERDR_ENV HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID",
];

function binaryAssignment(binary: string): string {
  // "~/x" has to expand, so only the part after it is quoted.
  return binary.startsWith("~/")
    ? `H="$HOME"/${shQuote(binary.slice(2))}`
    : `H=${shQuote(binary)}`;
}

function herdrPrefix(session: string): string {
  return session ? `"$H" --session ${shQuote(session)}` : `"$H"`;
}

function scriptHead(binary: string): string[] {
  return [
    ...PREAMBLE,
    binaryAssignment(binary),
    `command -v "$H" >/dev/null 2>&1 || { echo ${NOT_FOUND_MARK} >&2; exit 127; }`,
  ];
}

/**
 * A POSIX sh script that runs one herdr CLI command. It is sent on stdin to
 * `sh -s`, so the login shell (bash, zsh, fish) never parses our quoting.
 */
export function buildScript(
  binary: string,
  session: string,
  args: string[],
): string {
  return [
    ...scriptHead(binary),
    `exec ${herdrPrefix(session)} ${args.map(shQuote).join(" ")}`,
    "",
  ].join("\n");
}

// Reads one JSON line from herdr's socket. Single quotes are not allowed in
// here: the whole program is passed inside them.
const SOCKET_PY = [
  "import socket,sys",
  "s=socket.socket(socket.AF_UNIX)",
  "s.settimeout(10)",
  "s.connect(sys.argv[1])",
  's.sendall(sys.argv[2].encode()+b"\\n")',
  'buf=b""',
  'while not buf.endswith(b"\\n"):',
  "    chunk=s.recv(65536)",
  "    if not chunk: break",
  "    buf+=chunk",
  "sys.stdout.write(buf.decode())",
].join("\n");

/**
 * A script that sends one request to herdr's socket API, for methods the CLI
 * does not offer (focusing a pane by id). Exits with SOCKET_UNAVAILABLE when
 * the host has no python3 or herdr reports no socket.
 */
export function buildSocketScript(
  binary: string,
  session: string,
  method: string,
  params: Record<string, unknown>,
): string {
  const request = JSON.stringify({ id: "termix", method, params });
  return [
    ...scriptHead(binary),
    `sock=$(${herdrPrefix(session)} status server 2>/dev/null | sed -n 's/^ *socket: *//p' | head -n 1)`,
    `[ -n "$sock" ] && [ -S "$sock" ] || exit ${SOCKET_UNAVAILABLE}`,
    `command -v python3 >/dev/null 2>&1 || exit ${SOCKET_UNAVAILABLE}`,
    `exec python3 -c ${shQuote(SOCKET_PY)} "$sock" ${shQuote(request)}`,
    "",
  ].join("\n");
}

/** Runs a script on the host with `sh -s` and collects its output. */
export function runScript(
  client: SshClientLike,
  script: string,
  timeoutMs = 20_000,
): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    client.exec("sh -s", (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = "";
      let stderr = "";
      let settled = false;
      // A multibyte character can be split across chunks.
      const outDecoder = new StringDecoder("utf8");
      const errDecoder = new StringDecoder("utf8");
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        stream.close?.();
        reject(new Error("herdr command timed out"));
      }, timeoutMs);
      stream.on("data", (data: Buffer) => {
        if (stdout.length < MAX_OUTPUT) stdout += outDecoder.write(data);
      });
      stream.stderr.on("data", (data: Buffer) => {
        if (stderr.length < MAX_OUTPUT) stderr += errDecoder.write(data);
      });
      stream.on("error", (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      stream.on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: (stdout + outDecoder.end()).replace(/\r\n/g, "\n"),
          stderr: (stderr + errDecoder.end()).replace(/\r\n/g, "\n"),
          code: typeof code === "number" ? code : null,
        });
      });
      stream.end(script);
    });
  });
}

/** An error from herdr itself, carrying its JSON error code when it gave one. */
export class HerdrCommandError extends Error {
  constructor(
    message: string,
    readonly code: HerdrErrorCode,
    readonly herdrCode?: string,
  ) {
    super(message);
    this.name = "HerdrCommandError";
  }
}

/**
 * Parses a herdr CLI result. herdr prints JSON on stdout on success and a
 * JSON error on stderr with exit status 1.
 */
export function parseHerdrResult(result: ScriptResult): unknown {
  checkHerdrResult(result);
  // Input commands (send-text, send-keys, run) print nothing on success.
  const output = result.stdout.trim();
  if (!output) return {};
  try {
    const parsed = JSON.parse(output) as { result?: unknown };
    return parsed.result ?? parsed;
  } catch {
    return { output };
  }
}

/** Throws the herdr error a failed command reported; passes a success. */
export function checkHerdrResult(result: ScriptResult): void {
  if (result.code === 127 || result.stderr.includes(NOT_FOUND_MARK)) {
    throw new HerdrCommandError(
      "herdr is not installed on this host, or not on its PATH",
      "HERDR_NOT_INSTALLED",
    );
  }
  if (result.code === 0) return;
  // herdr writes its JSON error to stderr; read stdout too to be safe.
  const output = `${result.stdout}\n${result.stderr}`;
  const herdrCode = parseErrorJson(output)?.code;
  const message = herdrErrorMessage(output);
  const notRunning =
    herdrCode === "server_not_running" ||
    (!herdrCode && looksNotRunning(output));
  throw new HerdrCommandError(
    message || `herdr exited with code ${result.code ?? "unknown"}`,
    notRunning ? "HERDR_NOT_RUNNING" : "HERDR_ERROR",
    herdrCode,
  );
}

function parseErrorJson(
  stderr: string,
): { code?: string; message?: string } | null {
  for (const line of stderr.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: { code?: string; message?: string };
      };
      if (parsed.error) return parsed.error;
    } catch {
      // Not JSON; keep looking.
    }
  }
  return null;
}

function herdrErrorMessage(stderr: string): string | null {
  const parsed = parseErrorJson(stderr);
  if (parsed?.message) return parsed.message;
  const text = stderr.trim();
  return text ? text.split("\n").slice(-3).join(" ").slice(0, 500) : null;
}

function looksNotRunning(stderr: string): boolean {
  return /not running|no such file|connection refused|failed to connect|could not connect|no server/i.test(
    stderr,
  );
}
