---
name: aragon-browser
description: Drive the aragon-browser (a Nano browser built on Chromium/Electron) by writing JavaScript and piping it to the `aragon-browser` CLI, which runs it against an already-open browser. Use when the user asks to automate a website, browse/extract data from a page, fill or submit a form, test a web UI, take a page snapshot or screenshot, capture a page's accessibility tree, or drive a real browser with logins — especially multi-step web tasks, parallel isolated browser sessions, or when a task needs real DOM interaction (clicks, typing, file upload, drag, JS dialogs, clipboard). Do NOT use for HTTP-only scraping where no browser is needed.
---

# aragon-browser

A nano browser an agent drives by writing JavaScript.

`aragon-browser nodejs` reads a script from stdin (or `-e "..."`), injects the
helpers below as parameters, and runs it against the browser already open on this
machine. No imports, no CLI round-trips, one snapshot then act.

```bash
aragon-browser nodejs -e "const s = await taskSpace('demo'); const p = await s.newPage('https://example.com'); cliLog((await p.snapshot()).text)"
```

If `aragon-browser` is not on PATH, call it by absolute path:

```
# Windows
"%LOCALAPPDATA%\aragon-browser\bin\aragon-browser.cmd" nodejs -e "..."
# macOS / Linux
~/.local/share/aragon-browser/bin/aragon-browser nodejs -e "..."
```

If the browser is not running, start it: Windows `%LOCALAPPDATA%\Programs\aragon-browser\aragon-browser.exe`,
macOS `/Applications/aragon-browser.app`. The CLI reports
`ARAGON_RUNTIME_NOT_RUNNING` when nothing is listening.

Rules that keep runs cheap and reliable:

1. Take ONE snapshot, then act on the `@N` refs it printed.
2. After a navigation, either take a fresh snapshot or switch to a **stable
   locator** (`css:`, `role:`, `text=`, `href:`, `xpath=`) - refs are meant to die.
3. Batch a multi-step task into one script. Every helper is a plain `await`.
4. `snapshot({ interactiveOnly: true })` when you only need things to click.

---

## Targets: refs and locators

Anything that takes a `target` accepts all of these:

| Form | Example | Notes |
|---|---|---|
| `@N` / `ref=N` / `N` | `@12`, `ref=12`, `12` | from a snapshot. Stable while the document lives, **stale after navigation** |
| `css:<sel>` / `css=<sel>` | `css:#email`, `css=.card >> nth=0` | Playwright-style aliases, same as raw CSS |
| raw CSS | `#email`, `button.save` | |
| `loc=css:<sel>` | `loc=css:#email` | `loc=` is just a prefix; the rest is the same grammar |
| `loc=role:<role>[name="…"]` | `loc=role:button[name="Sign in"]` | accessible name, exact |
| `loc=role:<role>[name*="…"]` | `loc=role:button[name*="increment"]` | name substring |
| `text=<body>` | `text=Save changes` | unquoted = substring, case-insensitive |
| `text="<body>"` | `text="Save changes"` | quoted = exact, case-sensitive |
| `href:<path>` | `href:/checkout?step=2#pay` | exact `pathname+search+hash` on `<a href>`, **not** a substring |
| `xpath=<expr>` | `xpath=//button[@id="go"]` | |
| `<base> >> nth=N` | `css:.dup >> nth=1`, `nth=-1` = last | terminal only, and not on `role:` |
| `<css>:has-text("…")` | `button:has-text("Save")` | terminal only, substring |
| `<css>:text-is("…")` | `button:text-is("Save")` | terminal only, exact |

Semantics that are easy to get wrong, and are tested:

- **A missing target is `transient`; an ambiguous one is `permanent`.** Waits
  retry only transient failures, so a selector matching two buttons fails in
  ~1ms instead of burning the timeout.
- **CIDR-style matching:** a role locator resolves through the accessibility
  tree, so it works in shadow DOM and inside cross-site frames.
- **Shadow DOM is pierced** by `css:`, `text=` and `:has-text`. Plain
  `document.querySelectorAll` would not see it.
- `href:` is exact. `href:/pay` will not match `/pay/confirm`.
- `role:` aliases: `listboxoption` -> `option`, `textfield` -> `textbox`.

## Spaces

A space is an isolated workspace: its own window, tabs, cookies and storage.
Two spaces never share a login.

| helper | what it does |
|---|---|
| `taskSpace(nameOrId)` | select a space, or create it when the name is new. **This switches the current selection**, so the bare helpers (`snapshot`, `listTabs`, `runSiteTool`) follow it |
| `createTaskSpace(name, profileId?)` | create one (`listProfiles()` for ids) |
| `listTaskSpaces()` | every space with owner, agent state and tabs |
| `useTaskSpace(id)` | select by id for the bare helpers |
| `takeOverTaskSpace(id)` | resume after the user had control |
| `closeTaskSpace(id)` | close it and its window |

A space is owned by `agent` or `user`. While the user owns it, every mutating
call fails with `EGO_TASK_SPACE_USER_IN_CONTROL`. That is the browser protecting
the human, not a bug in your script.

`space.finish({ keep })` closes a space properly and **requires** `keep`
(`"all"` or an array of Page labels). Closing tabs is destructive, so there is no
default; a tab the user opened is never closed by it.

## Pages

```js
const space = await taskSpace('checkout');
const page  = await space.newPage('https://example.com/login');
```

Tabs carry a durable `label` (`p1`, `p2`, ...) so `space.page('p1')` keeps
referring to the same Page across rounds. `space.tabs()` returns
`{ id, label, origin, url, title, active }`.

## Observing

```js
const shot = await page.snapshot();
cliLog(shot.text);
```

`text` is an accessibility tree: one line per meaningful node, indented by depth,
with role, accessible name, state flags, and a `@N` ref for anything actionable.

```text
RootWebArea "Example"
  heading "Sign in" [level=1]
  textbox "Email" [required] @4
  button "Continue" @7
  frame "payment" url=https://id.example.com/frame
    textbox "Code" @9
```

Cross-site iframes are flattened at the position of their `<iframe>` element, so
a ref inside a frame is used exactly like any other ref. `shot.refs[].sessionId`
tells you which frame a ref lives in when you need to evaluate inside it.

## Acting

```js
await page.click('css:#submit');                        // trusted pointer events
await page.fill('css:#email', 'agent@example.com');      // focus + select-all + insertText
await page.press('Enter');
await page.type('typed slowly', { delayMs: 40 });
await page.hover('@3');
await page.scroll({ dy: 800 });
await page.drag('css:#card', 'css:#done');
await page.upload('css:#file', ['C:/tmp/report.pdf']);
await page.doubleClick('css:#row');
await page.rightClick('css:#row');
await page.goBack();
```

Clicks are real input events at the node's measured position with frame offsets
resolved, so they work inside cross-site frames and on sites that ignore
synthetic DOM events. `fill` uses select-all + `insertText`, which fires
`beforeinput`/`input` the way a keyboard does, so React/Vue controlled inputs
accept the value.

## Verifying

```js
await page.waitFor('css:.ok', { timeoutMs: 8000 });
await page.waitForText('Order confirmed');
await page.waitForNetworkIdle({ idleMs: 500 });
await page.waitForLoad();
const total = await page.evaluate("document.querySelector('#total').innerText");
await page.screenshot({ save: './shot.png', fullPage: true });
```

**After a click that navigates, use `waitForNavigation`, not `waitForLoad`.** The
old document is already `complete`, so `waitForLoad` returns instantly and you
read the page you were trying to leave.

```js
const navigation = page.waitForNavigation();   // arm it BEFORE the click
await page.click('css:#search');
await navigation;
```

## JS dialogs

`alert`/`confirm`/`prompt` block the renderer, so an unanswered dialog hangs the
page. The default policy is **dismiss** (the page keeps running); every dialog is
still recorded.

```js
await page.dialogs();                        // what was asked, and how it was answered
await page.setDialogPolicy('accept');        // or 'manual' to answer yourself
await page.waitForDialog();
await page.answerDialog({ accept: true, promptText: 'yes' });
```

## Clipboard

```js
await page.clipboard('text to paste');   // real system clipboard
const { text } = await page.readClipboard();
```

## Raw protocol

```js
await page.cdp({ method: 'Page.navigate', params: { url: 'https://example.com' } });
await page.cdp({ method: 'Runtime.evaluate', params: { expression: '1+1' } });
await sendCDPMessage({ method: 'Target.getTargets' });
```

Pass `sessionId` (from `page.frames()` or `snapshot().refs`) to talk to one frame.

## Learned site skills

`learnings/<site-id>/` holds reusable per-site knowledge. The format is
compatible with ego lite's, so an existing `learnings/` tree works unchanged.

```
learnings/x-com/
  manifest.json      { id, name, domains[], notes[], nodeTools{}, browserTools{} }
  notes/*.md         prose to read before acting
  tools/*.js         node-side helpers (ESM, exported under `callable`)
  browser-tools/*.js page-side helpers (evaluated in the page)
```

```js
const learned = await page.learn();
cliLog(learned.knowledge);                     // notes that apply to this URL
await runSiteTool('x-com', 'get_timeline_posts', { maxPosts: 20 });
await runSiteBrowserTool('x-com', 'post_from_active_element', {});
await validateSiteSkills();                    // { ok, errors }
```

Matching: `example.com` matches that host exactly, `*.example.com` matches
subdomains but **not** the apex - which is why real manifests list both.

Node tools receive `(ctx, args)` where `ctx.box` is a bound Page, so a learned
tool can drive a multi-step flow instead of only printing advice.

`npm run validate:skills` (or `aragon-browser learn`) enforces the rules, and the
important one is: **no snapshot refs in a learned note or tool**. A ref works
once and then breaks, so a site skill that stores one is defective by
construction.

## Errors worth handling

| code | meaning | retry? |
|---|---|---|
| `ARAGON_ELEMENT_TRANSIENT` | nothing matched yet | yes |
| `ARAGON_ELEMENT_PERMANENT` | ambiguous or malformed target | no - fix the selector |
| `ARAGON_REF_NOT_FOUND` | that ref was never printed in this space | take a snapshot |
| `ARAGON_REF_STALE` | the document reloaded; refs died | take a snapshot |
| `EGO_TASK_SPACE_USER_IN_CONTROL` | the human has the space | wait or take over |
| `ARAGON_RUNTIME_NOT_RUNNING` | the browser is not open | start it |
| `EGO_CDP_SEND_FAILED` | CDP refused the command | check method/params |

`aragon-browser skill` prints this same surface rendered from
`src/shared/public-api-schema.js`, which is the single source of truth - the
guide and the runtime cannot drift apart.

## API surface

<!-- HELP -->

Rendered from `src/shared/public-api-schema.js`; also available as
`aragon-browser help-api`.

