import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot } from "../src/kernel/ax-snapshot.js";

function ax(role, name, extra = {}) {
  return {
    nodeId: extra.nodeId ?? `${role}-${name}`,
    ignored: false,
    role: { type: "role", value: role },
    name: { type: "computedString", value: name },
    properties: extra.properties ?? [],
    childIds: extra.childIds ?? [],
    backendDOMNodeId: extra.backendNodeId,
    parentId: extra.parentId,
    ...extra.raw,
  };
}

const root = ax("RootWebArea", "Example", { nodeId: "root", childIds: ["h1", "email", "btn"] });
const heading = ax("heading", "Sign in", {
  nodeId: "h1",
  parentId: "root",
  properties: [{ name: "level", value: { type: "integer", value: 1 } }],
});
const email = ax("textbox", "Email", {
  nodeId: "email",
  parentId: "root",
  backendNodeId: 41,
  properties: [{ name: "focusable", value: { type: "booleanOrUndefined", value: true } }],
});
const button = ax("button", "Continue", {
  nodeId: "btn",
  parentId: "root",
  backendNodeId: 42,
});

test("snapshot renders roles, names, state and refs", () => {
  const { text, nodes } = buildSnapshot({
    frames: [
      {
        sessionId: "root",
        frameId: "F1",
        parentSessionId: null,
        ownerBackendNodeId: null,
        loaderId: "L1",
        axNodes: [root, heading, email, button],
      },
    ],
  });
  assert.match(text, /RootWebArea "Example"/);
  assert.match(text, /heading "Sign in" \[level=1\]/);
  assert.match(text, /textbox "Email".*@1/);
  assert.match(text, /button "Continue" @2/);
  assert.equal(nodes.length, 2, "only actionable nodes get refs");
  assert.equal(nodes[0].backendNodeId, 41);
});

test("unknown interactive role with focusable gets a ref", () => {
  const custom = ax("generic", "row", {
    nodeId: "row",
    parentId: "root",
    backendNodeId: 43,
    properties: [{ name: "focusable", value: { type: "boolean", value: true } }],
  });
  const { nodes } = buildSnapshot({
    frames: [
      {
        sessionId: "root",
        frameId: "F1",
        parentSessionId: null,
        ownerBackendNodeId: null,
        loaderId: "L1",
        axNodes: [{ ...root, childIds: ["row"] }, custom],
      },
    ],
  });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].backendNodeId, 43);
});

test("out-of-process iframe is spliced at its <iframe> element, not appended", () => {
  const iframeNode = ax("Iframe", "payment", { nodeId: "frame-el", parentId: "root", backendNodeId: 90 });
  const rootWithFrame = { ...root, childIds: ["h1", "email", "frame-el", "btn"] };
  const childRoot = ax("RootWebArea", "Payment", {
    nodeId: "child-root",
    childIds: ["code"],
  });
  const code = ax("textbox", "Code", {
    nodeId: "code",
    parentId: "child-root",
    backendNodeId: 91,
  });

  const { text, nodes, frameCount } = buildSnapshot({
    frames: [
      {
        sessionId: "root",
        frameId: "F1",
        parentSessionId: null,
        ownerBackendNodeId: null,
        loaderId: "L1",
        axNodes: [rootWithFrame, heading, iframeNode, email, button],
      },
      {
        sessionId: "child",
        frameId: "F2",
        parentSessionId: "root",
        ownerBackendNodeId: 90,
        loaderId: "L2",
        url: "https://id.example.com/frame",
        axNodes: [childRoot, code],
      },
    ],
  });

  assert.equal(frameCount, 2);
  const lines = text.split("\n");
  const frameBar = lines.findIndex((line) => line.includes('frame "payment"'));
  const childBar = lines.findIndex((line) => line.includes('textbox "Code"'));
  const buttonBar = lines.findIndex((line) => line.includes('button "Continue"'));
  assert.ok(frameBar > -1, "frame line present");
  assert.ok(childBar > frameBar, "child content nested under the frame");
  assert.ok(buttonBar > childBar, "sibling after the iframe still comes after it");
  assert.doesNotMatch(text, /RootWebArea "Payment"/, "child root is hoisted, not repeated");
  assert.equal(nodes.length, 3, "email + frame textbox + button");
  assert.deepEqual(
    nodes.map((node) => [node.sessionId, node.backendNodeId]),
    [
      ["root", 41],
      ["child", 91],
      ["root", 42],
    ],
  );
});

test("interactiveOnly drops static text but keeps controls", () => {
  const paragraph = ax("paragraph", "", { nodeId: "p", parentId: "root", childIds: ["t"] });
  const stat = ax("StaticText", "a long legal paragraph", { nodeId: "t", parentId: "p" });
  const { text } = buildSnapshot(
    {
      frames: [
        {
          sessionId: "root",
          frameId: "F1",
          parentSessionId: null,
          ownerBackendNodeId: null,
          loaderId: "L1",
          axNodes: [root, paragraph, stat, button],
        },
      ],
    },
    { interactiveOnly: true },
  );
  assert.doesNotMatch(text, /legal paragraph/);
  assert.match(text, /button "Continue"/);
});

test("empty input does not throw", () => {
  const result = buildSnapshot({ frames: [] });
  assert.equal(result.nodes.length, 0);
  assert.match(result.text, /empty snapshot/);
});
