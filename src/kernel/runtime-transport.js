import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { AragonError, ERROR_CODES } from "../shared/protocol.js";

const MAX_LINE_BYTES = 32 * 1024 * 1024;

/**
 * The runtime socket: newline-delimited JSON over loopback TCP, gated by a
 * per-launch random token. It is the aragon-browser equivalent of the native
 * `globalThis.ego` bridge: the browser owns the capability, the CLI borrows it.
 *
 * Deliberately dependency-free (node:net + node:crypto) so the browser has no
 * supply chain beyond Electron itself.
 */
export class RuntimeTransport {
  constructor({ handler, runtimeFile, metadata = {} }) {
    this.handler = handler;
    this.runtimeFile = runtimeFile;
    this.metadata = metadata;
    this.server = null;
    this.sockets = new Set();
    this.authed = new Set();
    this.token = crypto.randomBytes(24).toString("hex");
    this.port = 0;
  }

  async listen() {
    await new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.#onConnection(socket));
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this.server = server;
        const address = server.address();
        this.port = typeof address === "object" && address ? address.port : 0;
        resolve();
      });
    });
    this.#publish();
    return { port: this.port, token: this.token, runtimeFile: this.runtimeFile };
  }

  #publish() {
    const dir = path.dirname(this.runtimeFile);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      version: 1,
      pid: process.pid,
      port: this.port,
      token: this.token,
      startedAt: new Date().toISOString(),
      runtimeFile: this.runtimeFile,
      ...this.metadata,
    };
    fs.writeFileSync(this.runtimeFile, `${JSON.stringify(payload, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  #onConnection(socket) {
    this.sockets.add(socket);
    let authenticated = false;
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("error", () => this.#forget(socket));
    socket.on("close", () => this.#forget(socket));

    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE_BYTES) {
        socket.destroy();
        return;
      }
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line.length > 0) {
          if (!authenticated) {
            authenticated = this.#handleHandshake(socket, line);
          } else {
            void this.#handleRequest(socket, line);
          }
        }
        index = buffer.indexOf("\n");
      }
    });
  }

  #forget(socket) {
    this.sockets.delete(socket);
    this.authed.delete(socket);
  }

  #send(socket, message) {
    if (socket.destroyed) return;
    socket.write(`${JSON.stringify(message)}\n`);
  }

  #handleHandshake(socket, line) {
    let hello;
    try {
      hello = JSON.parse(line);
    } catch {
      socket.destroy();
      return false;
    }
    if (hello?.type !== "hello") {
      socket.destroy();
      return false;
    }
    const provided = Buffer.from(String(hello.token ?? ""));
    const expected = Buffer.from(this.token);
    const ok =
      provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
    if (!ok) {
      this.#send(socket, {
        type: "hello",
        ok: false,
        error: { error_code: ERROR_CODES.UNAUTHORIZED, message: "bad runtime token" },
      });
      socket.end();
      return false;
    }
    this.#send(socket, { type: "hello", ok: true, ...this.metadata });
    // Only now may this socket receive broadcasts.
    this.authed.add(socket);
    return true;
  }

  async #handleRequest(socket, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (cause) {
      this.#send(socket, {
        id: null,
        ok: false,
        error: { error_code: ERROR_CODES.INVALID_ARGUMENT, message: "malformed JSON" },
      });
      return;
    }
    const { id, method, params } = message ?? {};
    if (typeof method !== "string") {
      this.#send(socket, {
        id: id ?? null,
        ok: false,
        error: {
          error_code: ERROR_CODES.INVALID_ARGUMENT,
          message: "method must be a string",
        },
      });
      return;
    }
    try {
      const result = await this.handler(method, params ?? {}, { socket });
      this.#send(socket, { id: id ?? null, ok: true, result });
    } catch (error) {
      this.#send(socket, {
        id: id ?? null,
        ok: false,
        error: {
          error_code: error?.error_code ?? ERROR_CODES.OPERATION_FAILED,
          message: error?.message ?? String(error),
        },
      });
    }
  }

  /** Push an event to every authenticated socket. */
  broadcast(event) {
    // `this.sockets` also holds connections that have not completed the handshake
    // (and ones that failed it), so iterating it leaked space names, URLs and tool
    // output to any local process that could reach the port.
    for (const socket of this.authed) this.#send(socket, event);
  }

  async close() {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.authed.clear();
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }
    try {
      if (fs.existsSync(this.runtimeFile)) fs.unlinkSync(this.runtimeFile);
    } catch {
      // A leftover coordinates file is harmless: clients validate the pid.
    }
  }
}

export function readRuntimeCoordinates(runtimeFile) {
  let raw;
  try {
    raw = fs.readFileSync(runtimeFile, "utf8");
  } catch {
    throw new AragonError(
      ERROR_CODES.RUNTIME_NOT_RUNNING,
      "aragon-browser is not running: start it with `npm start` (or the packaged app), then retry",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AragonError(
      ERROR_CODES.RUNTIME_STALE,
      "runtime coordinates are unreadable; restart aragon-browser",
    );
  }
  if (!parsed?.port || !parsed?.token) {
    throw new AragonError(
      ERROR_CODES.RUNTIME_STALE,
      "runtime coordinates are incomplete; restart aragon-browser",
    );
  }
  return parsed;
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
