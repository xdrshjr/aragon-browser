import net from "node:net";
import { AragonError, ERROR_CODES, runtimeFilePath } from "../shared/protocol.js";
import { isProcessAlive, readRuntimeCoordinates } from "../kernel/runtime-transport.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Client half of the runtime bridge. Used by the `aragon-browser` CLI: it finds
 * the running browser through the published coordinates file, authenticates
 * with the per-launch token, and issues NDJSON requests.
 */
export class RuntimeClient {
  constructor({ runtimeFile = runtimeFilePath(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.runtimeFile = runtimeFile;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.onEvent = null;
    this.info = null;
  }

  async connect() {
    const coordinates = readRuntimeCoordinates(this.runtimeFile);
    if (!isProcessAlive(coordinates.pid)) {
      throw new AragonError(
        ERROR_CODES.RUNTIME_STALE,
        `aragon-browser (pid ${coordinates.pid}) is gone but left coordinates behind; start it again`,
      );
    }
    this.info = coordinates;
    // Create the handshake promise before the socket exists so an early reply
    // can never arrive with nobody listening.
    const handshake = this.handshake;
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({
        port: coordinates.port,
        host: "127.0.0.1",
      });
      this.socket = socket;
      socket.setEncoding("utf8");
      socket.once("connect", () => {
        socket.write(
          `${JSON.stringify({ type: "hello", token: coordinates.token })}\n`,
        );
        resolve();
      });
      socket.on("error", (error) => {
        this.#failAll(error);
        this.handshakeReject?.(error);
        reject(error);
      });
      socket.on("close", () => {
        this.#failAll(
          new AragonError(ERROR_CODES.RUNTIME_STALE, "runtime connection closed"),
        );
      });
      socket.on("data", (chunk) => this.#onData(chunk));
    });
    const hello = await handshake;
    this.info = { ...coordinates, ...hello };
    return this.info;
  }

  get handshake() {
    if (!this.handshakePromise) {
      this.handshakePromise = new Promise((resolve, reject) => {
        this.handshakeResolve = resolve;
        this.handshakeReject = reject;
        setTimeout(
          () => reject(new AragonError(ERROR_CODES.RUNTIME_STALE, "handshake timed out")),
          this.timeoutMs,
        ).unref?.();
      });
    }
    return this.handshakePromise;
  }

  #onData(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length > 0) this.#onMessage(line);
      index = this.buffer.indexOf("\n");
    }
  }

  #onMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message?.type === "hello") {
      if (message.ok) this.handshakeResolve?.(message);
      else {
        this.handshakeReject?.(
          new AragonError(
            message.error?.error_code ?? ERROR_CODES.UNAUTHORIZED,
            message.error?.message ?? "handshake rejected",
          ),
        );
      }
      return;
    }
    if (message?.event && !("id" in message)) {
      this.onEvent?.(message);
      return;
    }
    const entry = this.pending.get(message?.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else {
      entry.reject(
        new AragonError(
          message.error?.error_code ?? ERROR_CODES.OPERATION_FAILED,
          message.error?.message ?? "request failed",
        ),
      );
    }
  }

  #failAll(error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  request(method, params = {}, { timeoutMs } = {}) {
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(
        new AragonError(ERROR_CODES.RUNTIME_STALE, "runtime socket is not open"),
      );
    }
    const patience =
      Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.timeoutMs;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new AragonError(
            ERROR_CODES.OPERATION_FAILED,
            `${method} timed out after ${patience}ms`,
          ),
        );
      }, patience);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  close() {
    this.#failAll(new AragonError(ERROR_CODES.RUNTIME_STALE, "runtime client closed"));
    if (this.socket && !this.socket.destroyed) this.socket.end();
    this.socket = null;
  }
}
