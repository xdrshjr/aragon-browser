# Install or upgrade aragon-browser

Read this only when `aragon-browser` is not found, when the user asks to install
it, or when the CLI and the browser are out of step.

## 1. Is it already there?

```bash
aragon-browser --help
```

If that prints usage, skip to "Confirm the runtime". If the command is missing,
the browser app is not installed (the CLI ships inside the app; there is no
standalone npm install that can drive a browser on its own).

## 2. Install the app

**Windows** - run the installer, then open aragon-browser once:

```
aragon-browser-<version>-x64.exe
```

There is no silent prerequisite: the app writes the `aragon-browser` command to
`%LOCALAPPDATA%\aragon-browser\bin\` on first launch.

SmartScreen will warn once because the build is not code-signed. That is a real
gap, not a mistake in your steps: "More info" -> "Run anyway".

**macOS** - open the `.dmg`, drag the app to `/Applications`, launch it once.

## 3. Put the command on PATH

The app does **not** silently rewrite your PATH. Either:

- Menu -> `File -> Add CLI to PATH` (offers to run `setx` for you), or
- Add it yourself and reopen the terminal:

```bat
setx PATH "%LOCALAPPDATA%\aragon-browser\bin;%PATH%"
```

```sh
export PATH="$HOME/.local/share/aragon-browser/bin:$PATH"   # add to your shell profile
```

Until then, call it by absolute path:

```bat
"%LOCALAPPDATA%\aragon-browser\bin\aragon-browser.cmd" --help
```

```sh
~/.local/share/aragon-browser/bin/aragon-browser --help
```

An **existing** terminal keeps the PATH it started with, so open a new one before
concluding the install failed.

## 4. Confirm the runtime

The CLI is only half of it: the browser has to be running, because the CLI talks
to the live app over a loopback socket.

```bash
aragon-browser status
```

- Prints a JSON block with `currentVersion`, `packaged`, `spaces` -> ready.
- `ARAGON_RUNTIME_NOT_RUNNING` -> start the app and retry.

## 5. Confirm scripting works

```bash
aragon-browser nodejs -e "cliLog((await browserVersion()).engine)"
```

Then read the full guide, which is versioned with the installed build:

```bash
aragon-browser skill
```

## Upgrading

Install the new build over the old one. The app refreshes the shim and the agent
skill on launch, so re-read `aragon-browser skill` afterwards: a newer browser can
accept options the old guide never mentioned.

## Where things live

| What | Windows | macOS / Linux |
|---|---|---|
| App | `%LOCALAPPDATA%\Programs\aragon-browser` | `/Applications/aragon-browser.app` |
| CLI shim | `%LOCALAPPDATA%\aragon-browser\bin` | `~/.local/share/aragon-browser/bin` |
| Runtime coordinates | `%TEMP%\aragon-browser\runtime.json` | `/tmp/aragon-browser/runtime.json` |
| Site skills | next to the app: `resources/learnings` | same, inside the bundle |
| Agent skill copy | `~/.claude/skills/aragon-browser` (and other detected agents) | same |

Override the coordinates path with `ARAGON_RUNTIME_FILE` if you run more than one
build (tests do this).
