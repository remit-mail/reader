# Reader

An email client you run yourself. It connects to your existing IMAP/SMTP
mailbox, keeps a local copy of your mail, and gives you a fast web app to read,
search, and send from. IMAP stays the source of truth — Reader is a client over
your mailbox, not a new place your mail lives.

Reader is the open core of a larger system. This repository holds everything
needed to run it on a single machine: the API definitions, the core services,
the SQLite storage backend, and the web client. It is MIT licensed.

## What you get

- A web mail client: reading, threading, search, compose, and account settings.
- Full-text and semantic search over your mail, computed locally.
- A single-VM deployment that stores everything in SQLite files on one disk —
  no database server to run.
- Your IMAP credentials encrypted at rest with a key only you hold.

## Self-host it

You need a Linux box (amd64) with a container engine (Docker or Podman) and the
Compose v2 plugin. Point the installer at the address you will reach the app on:

```
curl -fsSL https://raw.githubusercontent.com/remit-mail/reader/main/install.sh \
  | bash -s -- --origin https://mail.example.com
```

The installer checks the host, downloads the SQLite compose stack, generates
your secrets into a `.env`, and starts everything. When it finishes it prints
the URL to open. The first sign-up on that page creates your account; after
that you add your mailbox from **Settings -> Add account** with your IMAP and
SMTP details.

Re-running the installer is safe: it keeps your existing `.env` and secrets.

TLS modes (`--tls-mode`):

| mode | what it does |
|---|---|
| `internal` (default) | HTTPS with Caddy's own CA. No external dependency; browsers warn until you trust the root certificate. |
| `off` | Plain HTTP. Reach it over a private network — a tailnet, a VPN, an SSH tunnel. |
| `tailscale` | Real certificate through the local `tailscaled`, for this box's tailnet name. |
| `acme` | Public Let's Encrypt. Needs public DNS and ports 80/443 reachable. |

Run `install.sh --help` for the full list, or `--dry-run` to check the host and
write the config without starting anything.

The `.env` the installer writes contains `FAKE_KMS_DATAKEY` — the key that
encrypts every stored mailbox credential. It is the only copy. Back it up; if
you lose it you have to re-enter each account's credentials.

## Develop it

The repository is an npm workspace. The generated API packages (client, types,
schemas) are published to npm and consumed as dependencies; TypeSpec in
`typespec/` is the single source of truth for the API and the database schema.

```
npm ci
npx tsp compile ./typespec
npm run build --workspaces --if-present
npm test --workspaces --if-present
```

A local development stack (the app plus its queue) runs with Docker Compose:

```
docker compose -f docker-compose.localhost-dev-generic.yml up
```

## How it fits together

Reader talks to your mailbox over IMAP and SMTP. A small set of queue workers
sync mail, push flag and folder changes back, send outgoing mail, and build the
search index. All relational state — messages, accounts, identities — lives in
SQLite; message bodies are cached on disk and can always be re-synced from IMAP.
The queue is an SQS-compatible seam served locally by ElasticMQ, so nothing here
depends on any cloud provider.

## License

MIT. See [LICENSE](LICENSE).
