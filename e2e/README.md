# Black-box end-to-end suite

This directory imports nothing from `packages/`. It talks to the deployment over
its public surface only — the HTTP API, the browser, and IMAP — so it cannot pass
because of a shape the tests and the app happen to share. It also does not need
the monorepo built, or installed: its own `npm ci` pulls Playwright and an IMAP
client and nothing else.

## Two stacks, one suite

Every coordinate the suite needs comes from the environment (`src/env.ts`) and
`playwright.config.ts` has no `webServer`, so the suite points at whatever is
running. Two things can be running.

**The image stack** (`npm run e2e`) drives the published
`ghcr.io/remit-mail/reader/*` images exactly as an operator gets them: the
reference SQLite compose file, plus Dovecot and a loopback edge port
(`deploy/vps/docker-compose.e2e.yml`). This is the deploy signal, and it runs
every spec.

**The source stack** (`npm run e2e:dev`) is the same deployment shape assembled
from the worktree — the queue sidecar, the migrator, the backend, the imap
worker, and the vite dev server, all from source, with the same Dovecot
container (`deploy/vps/docker-compose.dovecot.yml`). It is cheap enough to run
on a pull request, which makes it a regression guard rather than a deploy gate.

What the source stack does not have is the packaged edge: no Caddy, no APISIX.
The browser talks to vite, whose proxy table mirrors the Caddy routing 1:1.
Specs that assert something ABOUT the edge therefore have nothing to assert
against there, and are skipped by name — see `src/stack.ts`, and the annotation
each skipped test carries in the report. Today that is `gateway.spec.ts` and
nothing else.

## Running it

From the repository root:

```
npm run e2e              # image stack: up, test, down
npm run e2e:up           # start the image stack and wait for it
npm run e2e:logs         # tail the image stack's logs
npm run e2e:down         # destroy containers and volumes

npm run e2e:dev          # source stack: up, test, down
npm run e2e:dev:up       # build and start the source stack
npm run e2e:dev:logs     # print the source stack's logs
npm run e2e:dev:down     # stop the processes and remove the state

npm run e2e:test         # run the suite against whichever stack is up
```

`npm run e2e:test` is the fast loop while writing specs: the stack stays up
between runs, and it reads its configuration from the generated env whichever
lane wrote it, so it needs no argument to know which one it is talking to.

The source stack needs the monorepo installed and generated (`npm ci && make`),
which the suite itself does not. Four ports move it if something else is in the
way: `E2E_HTTP_PORT`, `E2E_IMAP_PORT`, `SERVER_PORT`, `QUEUE_SIDECAR_PORT`.

## Isolation

A reused stack has to be as trustworthy as a fresh one, or the fast loop above
quietly turns assertions about seeded mail into assertions that cannot fail —
the expected subjects are still sitting in the mailbox from last time, so a
broken sync looks like a working one.

So a run owns everything it touches. It signs up its own user, and it mints its
own IMAP username: Dovecot accepts any username with one shared password and
gives each its own empty maildir. Global setup checks that the mailbox it
claimed is empty before appending anything, and fails the run if it is not.

That is what lets the seeded-mail specs assert an exact set rather than "at
least these" — the mailbox held nothing else.

## How a spec gets data

There is no seeding. `global-setup.ts` performs the whole first-run path against
the live deployment:

1. sign up over `/api/auth/sign-up/email` and exchange the session for a bearer
   token,
2. claim a fresh IMAP mailbox and verify it is empty,
3. APPEND the fixture messages to `INBOX` over IMAP,
4. `POST /accounts` pointed at Dovecot — the compose service name on the image
   stack, the published loopback port on the source stack, since there the app
   is a host process,
5. `POST /accounts/{id}/sync` and wait for the mailbox list to appear.

It writes the account id, the IMAP username, the user's credentials, and the
browser's signed-in storage state to `.state/`, which the specs read. A spec
that needs its own message APPENDs it to the run's own mailbox.
