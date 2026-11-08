import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RuntimeTransport } from "../src/kernel/runtime-transport.js";
import { RuntimeClient } from "../src/cli/transport-client.js";

function tmpRuntimeFile(name) {
  return path.join(os.tmpdir(), "aragon-browser-test", `${name}-${process.pid}.json`);
}

async function startServer(runtimeFile, handler) {
  const transport = new RuntimeTransport({ handler, runtimeFile });
  const coordinates = await transport.listen();
  return { transport, coordinates };
}

test("round-trips a request and publishes coordinates", async (t) => {
  const runtimeFile = tmpRuntimeFile("roundtrip");
  const { transport, coordinates } = await startServer(runtimeFile, async (method, params) => {
    if (method === "echo") return { method, params };
    throw Object.assign(new Error("nope"), { error_code: "EGO_OPERATION_FAILED" });
  });
  t.after(async () => {
    await transport.close();
    fs.rmSync(path.dirname(runtimeFile), { recursive: true, force: true });
  });

  const published = JSON.parse(fs.readFileSync(runtimeFile, "utf8"));
  assert.equal(published.port, coordinates.port);
  assert.equal(published.pid, process.pid);

  const client = new RuntimeClient({ runtimeFile });
  await client.connect();
  const result = await client.request("echo", { hello: "world" });
  assert.deepEqual(result, { method: "echo", params: { hello: "world" } });
  client.close();
});

test("a wrong token is rejected, not silently accepted", async (t) => {
  const runtimeFile = tmpRuntimeFile("auth");
  const { transport } = await startServer(runtimeFile, async () => ({ ok: true }));
  t.after(async () => {
    await transport.close();
    fs.rmSync(path.dirname(runtimeFile), { recursive: true, force: true });
  });

  const published = JSON.parse(fs.readFileSync(runtimeFile, "utf8"));
  fs.writeFileSync(runtimeFile, JSON.stringify({ ...published, token: "deadbeef" }));

  const client = new RuntimeClient({ runtimeFile });
  await assert.rejects(
    () => client.connect(),
    (error) => error.error_code === "ARAGON_UNAUTHORIZED",
  );
  client.close();
});

test("worker errors come back as stable error codes", async (t) => {
  const runtimeFile = tmpRuntimeFile("errors");
  const { transport } = await startServer(runtimeFile, async () => {
    throw Object.assign(new Error("space 9 does not exist"), {
      error_code: "EGO_TASK_SPACE_NOT_FOUND",
    });
  });
  t.after(async () => {
    await transport.close();
    fs.rmSync(path.dirname(runtimeFile), { recursive: true, force: true });
  });

  const client = new RuntimeClient({ runtimeFile });
  await client.connect();
  await assert.rejects(
    () => client.request("anything"),
    (error) =>
      error.error_code === "EGO_TASK_SPACE_NOT_FOUND" &&
      /space 9/.test(error.message),
  );
  client.close();
});

test("missing runtime file says how to fix it", async () => {
  const client = new RuntimeClient({ runtimeFile: tmpRuntimeFile("absent") });
  await assert.rejects(
    () => client.connect(),
    (error) =>
      error.error_code === "ARAGON_RUNTIME_NOT_RUNNING" && /npm start/.test(error.message),
  );
});
