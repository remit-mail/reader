# Visual Regression

Playwright `toHaveScreenshot()` baselines for the Remit web client at three viewports: phone (390×844), tablet (768×1024), desktop (1440×900).

## Where baselines live

Baselines are **not** committed on `main`. They live on the orphan `visual-baselines` branch to keep binary churn out of `main` PR diffs.

When you run any `test:visual*` script, the wrapper:

1. Shallow-clones / fast-forwards `origin/visual-baselines` into `<repo-root>/.visual-baselines/`.
2. Symlinks `visual-regression/__screenshots__` into that cache.
3. Hands off to Playwright as normal.

Both the cache directory and the symlink are gitignored.

## Run the suite

```sh
npm run test:visual -w packages/remit-web-client
```

Compares against the baselines in the orphan branch. Fails on diffs greater than 5% of pixels (configured via `maxDiffPixelRatio` in `playwright.visual.config.ts`).

The 5% gate is a hold-over from when baselines were captured locally: text wrap-points shift a pixel or two between local-capture and CI-assert Chromium on the same string, cascading into every line below and burning a few percent of the canvas on busy mailbox-list snapshots. Time/date labels no longer contribute noise (see "Fixed clock" below).

Now that baselines are captured **in CI** (issue #465 — see "Update baselines" below), capture- and assert-Chromium share one rasterizer and that drift is gone, so the threshold should be tightened to ~1% as a follow-up once CI-captured baselines have landed on `main`. 5% is too loose to catch some layout regressions; tightening is tracked in the config comment and issue #465.

## Update baselines (capture in CI — issue #465)

Baselines are captured **in CI**, not from a local/agent Chromium. A local
rasterizer renders the phone viewport ~0.06 differently from the CI runner, so
locally-captured baselines false-fail the CI visual assert on phone screenshots.
The canonical landing path is the `Visual Baselines` workflow_dispatch job
(`.github/workflows/visual-baselines.yml`), which captures on the same runner
that asserts:

```sh
# Trigger against the PR's head branch (or head SHA), then re-run playwright.
gh workflow run visual-baselines.yml -f ref=<pr-head-branch-or-sha>
```

Full step-by-step landing dance: **[doc/runbooks/visual-baselines.md](../../../doc/runbooks/visual-baselines.md)**.

### Local capture — preview only, do NOT publish

The local scripts are still useful to *preview* a baseline diff in a worktree,
but their output must **not** become the baseline of record — that reintroduces
the cross-env drift the CI workflow exists to remove.

```sh
# 0. (Optional) Reset local DDB + storage so the seeder produces a
#    clean state. CI always runs against a fresh DynamoDB; locally
#    stale rows from prior runs can leak into baselines.
npm run ddb:test:reset

# 1. Re-capture every spec into the local cache (preview).
npm run test:visual:update -w packages/remit-web-client

# 2. Inspect the diff.
npm run test:visual:status -w packages/remit-web-client
# (or just `git -C .visual-baselines diff` for the gory detail)
```

`test:visual:publish` still exists (the CI workflow uses it on the runner) but
should not be run locally for a landing — use the workflow above instead.

`ddb:test:reset` deletes the `remit-test` DynamoDB table on the local stack
(`localhost:5435`), recreates it from `dynamodb/table.schema.json`, and wipes
`.remit/e2e-storage` so the next seeder run starts clean.

## Coverage

| Spec | Routes |
|---|---|
| `signin.spec.ts` | `/` (sign-in or empty state) |
| `onboarding.spec.ts` | `/onboarding` (wizard welcome step) |
| `mail.spec.ts` | `/mail`, `/mail/<id>`, `/mail/<id>?selectedMessageId=<id>` |
| `outbox.spec.ts` | `/mail/outbox` |
| `settings.spec.ts` | `/settings/accounts` |
| `compose.spec.ts` | `/mail/<id>` with compose surface open |

Each spec runs across all three projects (`phone`, `tablet`, `desktop`), so one assertion produces three baselines.

### Phone-only assertions

Some assertions only make sense on a single viewport and use `test.skip()` on the others. They still run in all three project lanes (the skip is decided per-test from `testInfo.project.name`), but the snapshot is only stored under one project directory.

| Snapshot | Why phone-only |
|---|---|
| `mail.spec.ts/phone/mail-thread-mobile-no-header.png` | Asserts the top 120px of the mobile thread view stays clear of the global Header. The `useSetHideHeader(true)` gate in `ConversationView` only fires when `isDesktop=false && has onBack && no inline-compose` — `useIsDesktop()` returns true at ≥768px so tablet/desktop never see the gated state. The clip concentrates a re-appearing 48px header into ~40% of the assertion area, well above the suite's 4% threshold. See issue #173. |

## CI

The `playwright-tests` job in `.github/workflows/ci.yml` runs the visual suite
(after the smoke step) on every PR. On failure it uploads the diff PNGs as a
workflow artifact named `playwright-test-reports`.

Baselines are (re)captured by the separate `Visual Baselines` workflow_dispatch
job (`.github/workflows/visual-baselines.yml`) — see "Update baselines" above and
[doc/runbooks/visual-baselines.md](../../../doc/runbooks/visual-baselines.md).

## Fixed clock — `REMIT_FAKE_NOW`

The seeder in `smoke/global-setup.ts` reads `REMIT_FAKE_NOW` (epoch ms) and uses it as the wall-clock anchor for every seeded `sentDate` / `internalDate`. With the clock pinned, the relative-time formatter ("Yesterday", "Thursday", "8:01 AM") produces byte-stable output, so baselines no longer need per-cell mask rectangles or a relaxed threshold.

`playwright.visual.config.ts` sets `REMIT_FAKE_NOW=1774008000000` (= `2026-04-01T10:00:00Z`) at config-load time, before Playwright spawns the dev/backend servers and before `globalSetup` runs. The literal ms value is hardcoded so it stays visible in diffs.

Override locally if you ever need a different anchor (for example to chase a relative-time edge case in another timezone):

```sh
REMIT_FAKE_NOW=$(date -u -d '2026-04-01T10:00:00Z' +%s%3N) \
  npm run test:visual -w packages/remit-web-client
```

Falls back to `Date.now()` when unset, so e2e and smoke runs (which want fresh timestamps) are unaffected.

## Local-dev gotcha — Vite reuse

The visual config sets `reuseExistingServer: !process.env.CI`. If another Vite dev server is already on `:5173` (e.g. from another worktree), Playwright reuses it. The captured baselines then reflect THAT codebase, not the worktree you ran the command from. Stop other dev servers before capturing baselines from a worktree.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `__screenshots__` exists but is not a symlink | Delete the directory and re-run `npm run test:visual:fetch`. The script refuses to clobber a real directory to avoid eating local baselines. |
| `fatal: Remote branch visual-baselines not found` | Re-create the orphan branch: see `git log` for prior commit on `visual-baselines` and re-push. |
| Baselines drift between local + CI | Make sure both run on the same Playwright + Chromium version. Locking is via `package-lock.json` and `npx playwright install chromium --with-deps`. |
| Phone/tablet test fails with `Executable doesn't exist` for webkit | Some Playwright `devices[]` profiles default to webkit; the visual config pins them to chromium. If you copy a project from another suite, set `browserName: "chromium"` explicitly. |
