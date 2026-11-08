---
name: aragon-browser
description: Drive a real Chromium browser (aragon-browser, built on Electron) by writing JavaScript and piping it to the `aragon-browser` CLI, which executes it against an already-open browser with your logins. Use when the user asks to automate a website, browse or extract data from a live page, fill or submit a form, click through a multi-step flow, test a web UI, capture a page snapshot/screenshot or its accessibility tree, handle a JS dialog or file upload, or run several isolated browser sessions in parallel. Do NOT use for plain HTTP scraping where no browser is needed.
---

# aragon-browser

The full usage guide is **not** in this file. It is versioned with the installed
browser and is the only copy that can be trusted against the running binary:

```bash
aragon-browser skill
```

Read that output before writing a script. It is generated from the runtime's own
API schema, so it cannot drift from what the browser actually accepts.

## The 30-second version

```bash
aragon-browser nodejs <<'JS'
const space = await taskSpace('demo');
const page  = await space.newPage('https://example.com');
await page.waitForLoad();
cliLog((await page.snapshot()).text);     // accessibility tree with @N refs
await page.click('css:a');                 // real trusted pointer event
JS
```

`nodejs` reads a script from stdin, injects every helper as a parameter, and runs
it. Batch the whole task into ONE script: a multi-step flow in one invocation is
far cheaper than a command per step.

## Rules that prevent the usual failures

1. **One snapshot, then act on its `@N` refs.** Re-snapshot after navigation.
2. **After a click that navigates, use `waitForNavigation`**, not `waitForLoad` -
   the old document is already `complete`, so `waitForLoad` returns instantly and
   you read the page you were trying to leave.
3. **Prefer stable locators for anything you will repeat**: `css:#id`,
   `loc=role:button[name="Save"]`, `text=...`, `href:/path`, `xpath=...`. Refs
   are meant to die with the document.
4. **A missing element is retryable; an ambiguous one is not.** If a selector
   matches two nodes the call fails immediately - add `>> nth=N` or more context.
5. **`taskSpace(name)` switches the selected space globally**, so bare helpers
   (`snapshot`, `runSiteTool`) follow it. Use `space.xxx` / `page.xxx` in scripts
   that touch more than one space.

## When something is wrong

| symptom | what to do |
|---|---|
| `aragon-browser` not found | install it, or call the absolute path (see `references/install.md`) |
| `ARAGON_RUNTIME_NOT_RUNNING` | the browser app is not open; start it, then retry |
| `ARAGON_REF_STALE` / `ARAGON_REF_NOT_FOUND` | take a fresh snapshot |
| `EGO_TASK_SPACE_USER_IN_CONTROL` | the human took the space; wait or ask before taking it back |
| page text looks garbled in a terminal | Windows console code page; run `chcp 65001`. The data is valid UTF-8 |

More in `references/troubleshooting.md`.

## Learned site skills

Per-site knowledge (notes plus reusable node-side and page-side tools) lives in
`learnings/<site-id>/` and is loaded automatically for matching domains:

```js
const learned = await page.learn();
cliLog(learned.knowledge);                                  // notes for this URL
await runSiteTool('x-com', 'get_timeline_posts', { maxPosts: 20 });
```

Check a pack before trusting it with `aragon-browser learn` (or
`validateSiteSkills()`). The rule that matters: **never store `@N` refs in a
learned note or tool** - a ref works once and then breaks.

## Layout of this skill

```
skills/aragon-browser/
  SKILL.md                    this file (what the agent loads)
  references/install.md       install and upgrade
  references/troubleshooting.md
  scripts/install.ps1         Windows installer helper
  scripts/install.sh          macOS installer helper
  learnings/                  site skills, loaded by domain
```
