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

Compares against the baselines in the orphan branch. Fails on diffs greater than 1% of pixels (configured via `maxDiffPixelRatio` in `playwright.visual.config.ts`).

## Update baselines

After an intentional visual change:

```sh
# 1. Re-capture every spec into the local cache.
npm run test:visual:update -w packages/remit-web-client

# 2. Inspect the diff.
npm run test:visual:status -w packages/remit-web-client
# (or just `git -C .visual-baselines diff` for the gory detail)

# 3. Push the new PNGs to the orphan branch.
npm run test:visual:publish -w packages/remit-web-client
```

`:publish` is a separate explicit step on purpose — re-running `:update` locally will never silently overwrite the baselines on the remote.

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

## Troubleshooting

| Symptom | Fix |
|---|---|
| `__screenshots__` exists but is not a symlink | Delete the directory and re-run `npm run test:visual:fetch`. The script refuses to clobber a real directory to avoid eating local baselines. |
| `fatal: Remote branch visual-baselines not found` | Re-create the orphan branch: see `git log` for prior commit on `visual-baselines` and re-push. |
| Baselines drift between local + CI | Make sure both run on the same Playwright + Chromium version. Locking is via `package-lock.json` and `npx playwright install chromium --with-deps`. |
