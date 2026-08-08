# Contributing

Thanks for looking. Reader is early and the contribution process is still
taking shape, so this is a stub — expect it to grow.

## Ground rules

- Open an issue before a large change so we can agree on the approach.
- Keep pull requests focused: one change, with a clear description of the
  intent.
- The API and the database schema are generated from TypeSpec in `typespec/`.
  Change the `.tsp` source and regenerate; do not hand-edit generated output.
- CI runs build, type-check, and unit tests. Keep them green. A pull request
  touching only prose skips the suites that need an install; the jobs show as
  skipped and `gate` still has to pass. Touch one file outside `docs/` or a
  `.md` and everything runs again.

## Local setup

```
npm ci
npx tsp compile ./typespec
npm run build --workspaces --if-present
npm test --workspaces --if-present
```

`npm run dev:sqlite` brings the app up from the worktree on the backend it
ships. See the README for the rest of the dev commands.

## Reviewing UI on a phone

`main` publishes Storybook to GitHub Pages. A pull request gets its own
preview on demand: tick "Deploy Storybook preview" in the bot comment it
opens with. The comment updates in place as the build runs and links the
preview once it's up, at
`https://remit-mail.github.io/reader/pr/<pr-number>/<head-sha>/`. It needs
write access on the repository, and it does not build branches pushed from a
fork.

Without a pull request open yet, serve the branch from the dev host instead:

```
npm run storybook:host -w @remit/workbench
```

That binds `0.0.0.0:6007`, so it is reachable at `http://<host>:6007`. Run it
from a detached worktree of the branch (`npm ci` and `npm run codegen` first)
to review a branch without disturbing your checkout.

Storybook Pages publishes to the `gh-pages` branch. A repository maintainer
sets the Pages source to it once:

```
gh api -X PUT repos/remit-mail/reader/pages -f build_type=legacy -f source[branch]=gh-pages -f source[path]=/
```

## Reporting bugs and security issues

For ordinary bugs, open an issue with steps to reproduce. For anything with a
security impact, please report it privately rather than in a public issue.

## License

By contributing you agree that your contributions are licensed under the
project's MIT license.
