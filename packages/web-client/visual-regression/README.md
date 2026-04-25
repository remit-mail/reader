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

Compares against the baselines in the orphan branch. Fails on diffs greater than 5% of pixels (configured via `maxDiffPixelRatio` in `playwright.visual.config.ts`). The threshold absorbs noise from relative-time labels — see "Known noise sources" below.

## Update baselines

After an intentional visual change:

```sh
# 0. (Optional) Reset local DDB + storage so the seeder produces a
#    clean state. CI always runs against a fresh DynamoDB; locally
#    stale rows from prior runs can leak into baselines.
npm run ddb:test:reset

# 1. Re-capture every spec into the local cache.
npm run test:visual:update -w packages/remit-web-client

# 2. Inspect the diff.
npm run test:visual:status -w packages/remit-web-client
# (or just `git -C .visual-baselines diff` for the gory detail)

# 3. Push the new PNGs to the orphan branch.
npm run test:visual:publish -w packages/remit-web-client
```

`:publish` is a separate explicit step on purpose — re-running `:update` locally will never silently overwrite the baselines on the remote.

`ddb:test:reset` deletes the `remit-test` DynamoDB table on the local stack
(`localhost:5435`), recreates it from `dynamodb/table.schema.json`, and wipes
`.remit/e2e-storage` so the next seeder run starts clean.

## Coverage

| Spec | Routes |
|---|---|
| `signin.spec.ts` | `/` (sign-in or empty state) |
| `mail.spec.ts` | `/mail`, `/mail/<id>`, `/mail/<id>?selectedMessageId=<id>` |
| `outbox.spec.ts` | `/mail/outbox` |
| `settings.spec.ts` | `/settings/accounts` |
| `compose.spec.ts` | `/mail/<id>` with compose surface open |

Each spec runs across all three projects (`phone`, `tablet`, `desktop`), so one assertion produces three baselines.

## CI

The `visual-tests` job in `.github/workflows/ci.yml` runs the suite on every PR. On failure it uploads the diff PNGs as a workflow artifact named `visual-test-report`.

## Known noise sources

The seeded test data in `smoke/global-setup.ts` uses `NOW = Date.now()` and offsets messages by relative day boundaries (`NOW - N * 86_400_000`). Each global-setup run produces fresh `sentDate`s, which feed the relative-time formatter ("Yesterday", "Thursday", "8:01 AM"). Two consequences:

1. The visible time/date labels drift between captures.
2. Messages near a day boundary can flip between two relative formats.

We cope with this in two layers:

- **Masks**: `MessageListItem` and `MessageCard` carry `data-testid="thread-time"` / `data-testid="message-date"` markers that the visual specs cover with Playwright `mask` rectangles.
- **Threshold**: `maxDiffPixelRatio` is set to `0.05` so any residual drift around the masked edges does not trip the suite. Real layout regressions move 10%+ of pixels.

A future fix is to make the seeder use a fixed clock (or accept a `REMIT_FAKE_NOW` env var) so baselines become byte-stable. Once that lands the threshold can drop back to `0.01`.

## Local-dev gotcha — Vite reuse

The visual config sets `reuseExistingServer: !process.env.CI`. If another Vite dev server is already on `:5173` (e.g. from another worktree), Playwright reuses it. The captured baselines then reflect THAT codebase, not the worktree you ran the command from. Stop other dev servers before capturing baselines from a worktree.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `__screenshots__` exists but is not a symlink | Delete the directory and re-run `npm run test:visual:fetch`. The script refuses to clobber a real directory to avoid eating local baselines. |
| `fatal: Remote branch visual-baselines not found` | Re-create the orphan branch: see `git log` for prior commit on `visual-baselines` and re-push. |
| Baselines drift between local + CI | Make sure both run on the same Playwright + Chromium version. Locking is via `package-lock.json` and `npx playwright install chromium --with-deps`. |
| Phone/tablet test fails with `Executable doesn't exist` for webkit | Some Playwright `devices[]` profiles default to webkit; the visual config pins them to chromium. If you copy a project from another suite, set `browserName: "chromium"` explicitly. |
