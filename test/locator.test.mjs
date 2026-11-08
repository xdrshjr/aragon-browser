import assert from "node:assert/strict";
import test from "node:test";
import {
  ElementResolutionError,
  buildLocatorFindJs,
  classifyMatchCount,
  describeLocator,
  isPlainCssSelector,
  normalizeRole,
  parseLocator,
  parseLocatorOrThrow,
  parseRefId,
} from "../src/kernel/locator.js";

test("refs: @N, ref=N and bare digits, but nothing else", () => {
  assert.equal(parseRefId("@21"), "21");
  assert.equal(parseRefId("ref=7"), "7");
  assert.equal(parseRefId("5"), "5");
  assert.equal(parseRefId("  @3  "), "3");
  assert.equal(parseRefId("button"), null);
  assert.equal(parseRefId("@media (min-width: 1px)"), null);
  assert.equal(parseRefId("ref=abc"), null);
  assert.equal(parseRefId(""), null);
});

test("css aliases: css:, css= and loc=css: all reach the same selector", () => {
  for (const input of ["css:#a", "css=#a", "loc=css:#a"]) {
    const locator = parseLocator(input);
    assert.equal(locator.kind, "css");
    assert.equal(locator.selector, "#a");
  }
  // An empty selector after the prefix is not a bare CSS selector: the input
  // still looks like a locator, so parseLocatorOrThrow rejects it (see below).
  assert.equal(parseLocator("css:"), null);
});

test("raw CSS with a colon inside an attribute is not mistaken for a prefix", () => {
  const locator = parseLocator('input[aria-label="Shadow field"]');
  assert.equal(locator.kind, "css");
  assert.equal(locator.selector, 'input[aria-label="Shadow field"]');
});

test("href is matched exactly, not as a substring", () => {
  const locator = parseLocator("loc=href:/checkout?step=2#pay");
  assert.equal(locator.kind, "href");
  assert.equal(locator.href, "/checkout?step=2#pay");
});

test("text= unquoted is case-insensitive substring, quoted is exact", () => {
  const loose = parseLocator("text=Save changes");
  assert.equal(loose.kind, "text");
  assert.equal(loose.mode, "substring");
  assert.equal(loose.text, "Save changes");

  const exactDouble = parseLocator('text="Save changes"');
  assert.equal(exactDouble.mode, "exact");
  assert.equal(exactDouble.text, "Save changes");

  const exactSingle = parseLocator("loc=text='Save'");
  assert.equal(exactSingle.mode, "exact");
  assert.equal(exactSingle.text, "Save");
});

test("role: exact and substring name modes, with alias normalisation", () => {
  const exact = parseLocator('loc=role:button[name="Sign in"]');
  assert.equal(exact.kind, "role");
  assert.equal(exact.role, "button");
  assert.equal(exact.name, "Sign in");
  assert.equal(exact.nameMode, "exact");

  const substring = parseLocator('loc=role:button[name*="increment COUNTER"]');
  assert.equal(substring.nameMode, "substring");

  const unquoted = parseLocator("loc=role:button[name=Save]");
  assert.equal(unquoted.name, "Save");

  const aliased = parseLocator('role:listboxoption[name="Upload"]');
  assert.equal(aliased.role, "option");
  assert.equal(normalizeRole("TextField"), "textbox");
});

test("terminal >> nth=N only accepts a trailing integer and rejects role", () => {
  const nth = parseLocator(".dup >> nth=1");
  assert.equal(nth.kind, "nth");
  assert.equal(nth.index, 1);
  assert.equal(nth.locator.selector, ".dup");

  assert.equal(parseLocator("text=Save >> nth=-1").index, -1);
  assert.deepEqual(parseLocator("loc=css:.dup >> nth=0").kind, "nth");
  // role cannot take an nth, and a nested nth is invalid.
  assert.deepEqual(parseLocator('role:button[name="A"] >> nth=0'), { valid: false });
  assert.deepEqual(parseLocator(".a >> nth=0 >> nth=1"), { valid: false });
  // A >> inside an attribute value is not a separator.
  const attr = parseLocator('a[data-x="a>>b"]');
  assert.equal(attr.kind, "css");
});

test("terminal text pseudos become cssText, and at top level only", () => {
  const hasText = parseLocator('button:has-text("Save changes")');
  assert.equal(hasText.kind, "cssText");
  assert.equal(hasText.selector, "button");
  assert.equal(hasText.text, "Save changes");
  assert.equal(hasText.mode, "substring");

  const textIs = parseLocator("loc=css:button:text-is('Save')");
  assert.equal(textIs.mode, "exact");
  assert.equal(textIs.text, "Save");

  // Only terminal: something after the closing paren means it is not our pseudo.
  assert.deepEqual(parseLocator('button:has-text("a") .child'), { valid: false });
  // A comma at the top level makes it ambiguous, so it is rejected rather than
  // silently matching half the selector.
  assert.deepEqual(parseLocator('a:has-text("x"), b'), { valid: false });
});

test("css escapes inside the pseudo argument are decoded", () => {
  const locator = parseLocator('button:text-is("\\41 B")');
  assert.equal(locator.text, "AB");
});

test("malformed locators throw permanent, plain CSS parses as css", () => {
  assert.throws(
    () => parseLocatorOrThrow("loc=role:button"),
    (error) =>
      error instanceof ElementResolutionError && error.kind === "permanent",
  );
  assert.throws(
    () => parseLocatorOrThrow("loc=href:"),
    (error) => error.kind === "permanent",
  );
  assert.throws(
    () => parseLocatorOrThrow("css:"),
    (error) => error.kind === "permanent",
  );
  const plain = parseLocatorOrThrow("div#main");
  assert.equal(plain.kind, "css");
  assert.equal(plain.selector, "div#main");
  // Only genuinely empty input yields no locator at all.
  assert.equal(parseLocatorOrThrow("   "), null);
});

test("isPlainCssSelector separates CSS from refs, xpath and locators", () => {
  assert.equal(isPlainCssSelector("div#main"), true);
  assert.equal(isPlainCssSelector("@5"), false);
  assert.equal(isPlainCssSelector("xpath=//div"), false);
  assert.equal(isPlainCssSelector("role:button[name=\"A\"]"), false);
  assert.equal(isPlainCssSelector(""), false);
});

test("describeLocator round-trips every kind for error messages", () => {
  assert.match(describeLocator(parseLocator("css:.a")), /^css:\.a$/);
  assert.match(describeLocator(parseLocator('text="Hi"')), /text="Hi"\(exact\)/);
  assert.match(describeLocator(parseLocator("href:/x")), /^href:\/x$/);
  assert.match(
    describeLocator(parseLocator('role:button[name*="A"]')),
    /role:button\[name\*="A"\]/,
  );
  assert.match(describeLocator(parseLocator(".a >> nth=-1")), /nth=-1$/);
});

test("match-count classification decides retry versus give up", () => {
  assert.equal(classifyMatchCount("Locator css:.a matched 0 elements"), "transient");
  assert.equal(classifyMatchCount("Locator css:.a matched 1 elements"), "transient");
  assert.equal(classifyMatchCount("Locator css:.a matched 3 elements"), "permanent");
  assert.equal(classifyMatchCount("no number here"), "transient");
});

test("generated JS is self-contained and interpolates safely", () => {
  const js = buildLocatorFindJs(parseLocator(`css:button[data-x="a'b"]`));
  assert.match(js, /__aragonQueryAll/);
  assert.match(js, /button\[data-x=/);
  assert.match(js, /__aragonActionable/);
});
