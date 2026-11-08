import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
const pkg = JSON.parse(read("package.json"));

/**
 * The release pipeline had version numbers written by hand in four places
 * (package.json, main.js, the publish script, the README) and they disagreed
 * after every bump. `runtime.version` reporting the previous release is a
 * support ticket with no symptom; these assertions make it a red test.
 */

test("the app reports the version in package.json, not a literal", () => {
  const main = read("src", "main", "main.js");
  assert.match(main, /const VERSION = app\.getVersion\(\)/, "VERSION must come from the packaged package.json");
  // A stray semver literal here is the bug: it survives a bump silently.
  assert.doesNotMatch(main, /VERSION = "\d+\.\d+\.\d+"/);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json version must be a plain semver");
});

test("installer names and the release script all derive from package.json", () => {
  // electron-builder writes ${version} into the artifact names; the release script
  // rebuilds the same names from pkg.version. If either hardcodes a number, an
  // upload either 404s or ships the previous build under a new tag.
  const builder = read("electron-builder.yml");
  // The file is JSON-shaped YAML, so the key is quoted.
  assert.match(builder, /"?artifactName"?:\s*"aragon-browser-\$\{version\}-\$\{arch\}\.\$\{ext\}"/);
  assert.match(builder, /"?artifactName"?:\s*"aragon-browser-\$\{version\}-portable\.\$\{ext\}"/);

  const script = read("scripts", "publish-release.mjs");
  assert.match(script, /const TAG = `v\$\{VERSION\}`/);
  assert.match(script, /aragon-browser-\$\{VERSION\}-x64\.exe/);
  assert.doesNotMatch(script, /const (TAG|NAME) = "v?\d+\.\d+\.\d+"/);
  // It refuses to publish a tag that is not on the remote: a release built on a
  // missing tag gets one created at the default branch tip, which may not be the
  // commit that was packaged.
  assert.match(script, /ls-remote/);
  // And it re-reads the release afterwards instead of trusting its own uploads.
  assert.match(script, /state === "uploaded"/);
});

test("the release notes for the current version exist and match the build", () => {
  const notesPath = path.join(ROOT, "scripts", "release-notes", `v${pkg.version}.md`);
  assert.ok(
    fs.existsSync(notesPath),
    `scripts/release-notes/v${pkg.version}.md is missing - write the notes before tagging`,
  );
  const notes = fs.readFileSync(notesPath, "utf8");
  // The notes name the artifacts a user is about to download.
  assert.match(notes, new RegExp(`aragon-browser-${pkg.version.replaceAll(".", "\\.")}-x64\\.exe`));
  assert.match(notes, new RegExp(`aragon-browser-${pkg.version.replaceAll(".", "\\.")}-portable\\.exe`));
  // A test count in the notes is a claim; keep the honest one.
  const suite = read("test", "titlebar.test.mjs").length > 0;
  assert.ok(suite, "test suite present");
});

test("the README's download table names files that this version actually builds", () => {
  const readme = read("README.md");
  for (const suffix of ["x64.exe", "portable.exe"]) {
    assert.match(
      readme,
      new RegExp(`aragon-browser-${pkg.version.replaceAll(".", "\\.")}-${suffix.replace(".", "\\.")}`),
      `README still advertises the wrong ${suffix} name`,
    );
  }
  // The version badge has to link at the tag this release will create.
  assert.match(readme, new RegExp(`badge/version-${pkg.version.replaceAll(".", "\\.")}-blue`));
  assert.match(readme, new RegExp(`releases/tag/v${pkg.version.replaceAll(".", "\\.")}`));
});
