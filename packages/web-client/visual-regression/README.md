# Visual Regression

Playwright `toHaveScreenshot()` baselines for the Remit web client at
three viewports: phone (390×844), tablet (768×1024), desktop (1440×900).

## Run the suite

```bash
npm run test:visual -w packages/remit-web-client
```

Reads baselines from `__screenshots__/` and fails on diffs greater than
1% of pixels (configured via `maxDiffPixelRatio` in
`playwright.visual.config.ts`).

## Update baselines

After an intentional visual change:

```bash
npm run test:visual:update -w packages/remit-web-client
```

Inspect the diff, commit the new PNGs.

## Coverage

| Spec | Routes |
|---|---|
| `signin.spec.ts` | `/signin` (Cognito-not-configured banner state) |
| `mail.spec.ts` | `/mail` (no mailbox), `/mail/<id>` (list), `/mail/<id>?selectedMessageId=<id>` (thread open) |
| `outbox.spec.ts` | `/mail/outbox` |
| `settings.spec.ts` | `/settings/accounts` |
| `compose.spec.ts` | `/mail/<id>` with compose surface open |

Each spec runs across all three projects defined in the config (`phone`,
`tablet`, `desktop`), so one assertion produces three baselines.

## Bootstrapping baselines (first run)

The repo ships **without** committed baselines — they have to be
captured against the same backend snapshot the suite expects. The first
run is bootstrap:

```bash
# from repo root, with backend deps installed
npm run test:visual:update -w packages/remit-web-client
git add packages/remit-web-client/visual-regression/__screenshots__
git commit -m "chore(web-client): seed visual-regression baselines"
```

CI will use those committed PNGs going forward.

## CI wiring (follow-up)

Adding a new GitHub-Actions job that runs `npm run test:visual` is
documented in the parent PR description. Defer until the baselines have
been seeded and stabilized over a few PRs.
