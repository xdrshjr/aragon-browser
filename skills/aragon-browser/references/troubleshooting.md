# Troubleshooting aragon-browser

Every entry below is a failure this project has actually hit and tested against.

## The command does not exist

```
'aragon-browser' is not recognized as an internal or external command
```

The app installs the shim on **first launch only**, so:

1. Did the app ever start? Launch it once.
2. Did you open a **new** terminal? An existing one keeps the old PATH.
3. Call it by absolute path to confirm the shim exists:
   `"%LOCALAPPDATA%\aragon-browser\bin\aragon-browser.cmd" --help`
4. Still nothing: Menu -> `Agent -> Show setup status`.

## `ARAGON_RUNTIME_NOT_RUNNING`

The CLI is a client. Nothing is listening, which means the browser is not open.

1. Start the app.
2. `aragon-browser status` should now print JSON.
3. If it still fails, the coordinates file is stale after a crash. Check
   `%TEMP%\aragon-browser\runtime.json`; the app rewrites it on next launch. The
   CLI validates the recorded pid, so a leftover file gives
   `ARAGON_RUNTIME_STALE` rather than talking to a dead socket.

## `ARAGON_REF_STALE` / `ARAGON_REF_NOT_FOUND`

Refs (`@12`) are bound to one document. Navigation, a reload, or a full DOM
rebuild makes them invalid **on purpose** - a ref that silently pointed at
whatever now occupies that node id would be worse.

```js
await page.snapshot();          // take fresh refs
await page.click('css:#submit'); // or stop using refs entirely
```

## `ARAGON_ELEMENT_PERMANENT` - ambiguous selector

The selector matched more than one element. This is classified permanent so a
`waitFor` fails in milliseconds instead of burning the timeout.

```js
await page.click('css:.card >> nth=1');          // pick one deterministically
await page.click('loc=role:button[name="Pay"]'); // or be more specific
```

## `ARAGON_ELEMENT_TRANSIENT` - not there yet

Nothing matched. Either it has not rendered, or the selector is wrong. Give it
time before concluding the page is broken:

```js
await page.waitFor('css:#results', { timeoutMs: 8000 });
```

## A click did nothing

The most common cause is reading the page before the navigation completes:

```js
// WRONG - the old document is already "complete"
await page.click('css:#search');
await page.waitForLoad();

// RIGHT - arm the wait before the click
const navigation = page.waitForNavigation();
await page.click('css:#search');
await navigation;
```

Second most common: the element is covered by an overlay or has
`pointer-events: none`. The click is dispatched at the element's measured
position, so something else received it. Check with
`await page.evaluate("document.elementFromPoint(x, y).outerHTML")`.

## A dialog hangs the page

`alert`/`confirm`/`prompt` block the renderer until answered. The default policy
is `dismiss`, so pages keep running; every dialog is still recorded.

```js
await page.dialogs();                   // what was asked, how it was answered
await page.setDialogPolicy('accept');    // this confirm() should return true
```

## The page never finishes loading

A page with an open connection (long-poll, streaming) never goes idle, so
`waitForNetworkIdle` will time out. Use a targeted wait instead:

```js
await page.waitForText('Ready');
```

## Page text looks like `�?` in the terminal

Windows consoles render with the OEM code page (936 on a Chinese system). The
data is valid UTF-8; only the terminal display is wrong.

```bat
chcp 65001
```

Piping to a file or to another process is unaffected.

## The space says the user is in control

```
EGO_TASK_SPACE_USER_IN_CONTROL
```

The human took over that space. This is the browser protecting them, not a bug:
an agent typing into a form the user is filling in would be worse. Ask before
taking it back.

```js
await space.waitForControl({ timeout: 300000 }); // wait for the handoff
await takeOverTaskSpace(space.id);               // or take it back deliberately
```

## Another agent session seems to interfere

Each space has its own session partition, so cookies and storage are isolated.
What is **shared** by design is the running browser process (one runtime socket).
Use distinct space names per task:

```js
const space = await taskSpace(`task-${Date.now()}`);
```

## Packaging-only failures

If something works in a source checkout but not in the installed app, it is
almost always a path assumption. Check these:

- `aragon-browser status` -> `"packaged": true` proves the asar and resources
  loaded.
- Site skills resolve from `resources/learnings`. If `listLearnedSites()` returns
  nothing, the `extraResources` step of the build was skipped.
- `aragon-browser skill` reads `skill-body/SKILL.md` from next to the bundle. If
  it throws, rebuild with `npm run build:cli`.

## Nothing above matches

```bash
aragon-browser status             # is the runtime alive?
aragon-browser nodejs -e "cliLog(JSON.stringify(await listTaskSpaces(), null, 2))"
```

Then run with `ARAGON_DEBUG=1` on the app to see renderer errors, and check the
app's terminal output for the first error - later ones are usually consequences.
