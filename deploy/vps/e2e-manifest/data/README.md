# e2e manifest data

Served by `serve.mjs` at `http://manifest/manifest.json` (issue #599). Empty
on purpose: with no `manifest.json` here, the updater's manifest fetch 404s
from container boot, so every e2e run starts the self-update check in a
known, stable `checkFailed` state.

`packages/e2e/specs/system-update-check.spec.ts` writes a real
`manifest.json` into this directory partway through its own run — the bind
mount means the running `manifest` container serves it immediately, no
restart needed — and asserts the panel picks up that exact content after the
check button is pressed. The test removes the file again when it finishes,
so the stack returns to its starting state for any spec that runs after it.
