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

## Changing the UI

The components, the web client and the Storybook live in
[remit-mail/reader-ui](https://github.com/remit-mail/reader-ui), which
publishes `@remit/ui` and `@remit/web-client`. A UI change lands there,
ships on a `ui-v*` tag, and reaches this repo when `packages/web` and
`packages/mcp-server` bump their exact pins.

## Reporting bugs and security issues

For ordinary bugs, open an issue with steps to reproduce. For anything with a
security impact, please report it privately rather than in a public issue.

## License

By contributing you agree that your contributions are licensed under the
project's MIT license.
