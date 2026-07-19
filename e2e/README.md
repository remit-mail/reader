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
stays up between runs. Every run signs up a fresh user, so state left behind by
a previous run does not leak into the next one.

## How a spec gets data

There is no seeding. `global-setup.ts` performs the whole first-run path against
the live deployment:

1. sign up over `/api/auth/sign-up/email` and exchange the session for a bearer
   token,
2. `POST /accounts` pointed at the Dovecot service,
3. APPEND the fixture messages to `INBOX` over IMAP,
4. `POST /accounts/{id}/sync` and wait for the mailbox list to appear.

It writes the account id, the user's credentials, and the browser's signed-in
storage state to `.state/`, which the specs read. A spec that needs its own
message APPENDs it itself with a subject unique to that spec.
