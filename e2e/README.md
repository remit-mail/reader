# Black-box end-to-end suite

Drives the published `ghcr.io/remit-mail/reader/*` images exactly as an operator
gets them: the reference SQLite compose file, plus a Dovecot server and a
loopback edge port (`deploy/vps/docker-compose.e2e.yml`).

This directory imports nothing from `packages/`. It talks to the deployment over
its public surface only — the HTTP API, the browser, and IMAP — so it cannot pass
because of a shape the tests and the app happen to share. It also does not need
the monorepo built, or installed: its own `npm ci` pulls Playwright and an IMAP
client and nothing else.

## Running it

From the repository root:

```
npm run e2e          # up, test, down
npm run e2e:up       # start the stack and wait for it
npm run e2e:test     # run the suite against a running stack
npm run e2e:logs     # tail the stack's logs
npm run e2e:down     # destroy containers and volumes
```

`npm run e2e:test` on its own is the fast loop while writing specs: the stack
stays up between runs.

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
4. `POST /accounts` pointed at the Dovecot service,
5. `POST /accounts/{id}/sync` and wait for the mailbox list to appear.

It writes the account id, the IMAP username, the user's credentials, and the
browser's signed-in storage state to `.state/`, which the specs read. A spec
that needs its own message APPENDs it to the run's own mailbox.
