---
title: Contributing
description: Ground rules, local setup, and the discipline the codebase runs on.
---

# Contributing

Thanks for looking. Reader is early and the contribution process is still taking shape.

## Ground rules

- Open an issue before a large change, so we agree on the approach before the work exists.
- Keep pull requests focused: one change, with a clear description of the intent.
- TypeSpec in `typespec/` generates the API and the database schema. Change the `.tsp` source and regenerate. Never hand-edit generated output.
- CI runs build, type-check and unit tests. Keep them green.

## The rules that bind

Two architecture documents are mandatory reading, because CI and review hold changes to them:

- `docs/architecture/imap-mutations.md`: every operation that mutates the mail server follows the mutator pattern. Every dependent operation states wait-or-reconcile as an explicit decision. [The short version](../architecture/mutations/).
- `docs/architecture/url-state.md`: every path segment, query param and fragment binding has one owner, and no fact lives in more than one tier.

Tests assert server truth. A flow that touches IMAP runs against the real Dovecot server. Asserting local state that mirrors the server is not the proof.

## Local setup

```
npm ci
npx tsp compile ./typespec
npm run build --workspaces --if-present
npm test --workspaces --if-present
```

`npm run dev:sqlite` brings the whole app up from the worktree: SQLite, the queue, the migrator, the backend, the workers, the web client. The dev stack is the shape a real install runs, so what you develop against is what ships. State lives under `.remit/dev-sqlite`; deleting that directory resets the stack.

## Storybook previews

`main` publishes Storybook to GitHub Pages, and a pull request gets its own preview on demand: tick "Deploy Storybook preview" in the bot comment it opens with. UI changes land with their stories in the same pull request.

## Bugs and security

For ordinary bugs, open an issue with steps to reproduce. For anything with a security impact, report it privately instead of opening a public issue.

By contributing you agree to license your contributions under the project's MIT license.
