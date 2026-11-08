# aragon fixture site

A local test site used by the smoke suite. Two origins share this learning:
`127.0.0.1` (the page) and `localhost` (the cross-site payment iframe).

## What is on the page

- `h1` "Sign in"
- `#email` — a required email input
- `#go` — a "Continue" button that writes `clicked:<email>` into `#result`
- `iframe#pay` — a cross-site payment frame with `#code` and `#paybtn`

## Durable locators

Use these instead of refs; refs die on navigation.

| Thing | Locator |
|---|---|
| email input | `css:#email` |
| continue button | `loc=role:button[name="Continue"]` |
| result div | `css:#result` |
| payment code input | `css:#code` (inside the cross-site frame) |
| pay button | `loc=role:button[name="Pay now"]` |

## Gotchas

- The frame is cross-origin, so `document.getElementById('pay').contentDocument`
  is `null`. Read inside it through its own CDP session (`box.cdp(...)` with the
  frame's `sessionId`) — the snapshot's `refs[].sessionId` tells you which.
- `#go` is `type="button"`, so nothing submits by itself. Assert on `#result`.
