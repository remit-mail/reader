---
title: Architecture overview
description: A set of small services over SQLite, a queue, and an IMAP server that stays the source of truth.
---

# Architecture overview

Reader talks to your mailbox over IMAP and SMTP. A small set of queue workers sync mail, push flag and folder changes back, send outgoing mail, and build the search index. The web client talks to one backend API behind an edge gate.

## The pieces

- **caddy** terminates TLS and is the only thing publishing host ports.
- **apisix** checks the identity JWT on every API request, with the route table baked in at build time.
- **backend** serves the API. The same image runs the one-shot migrator.
- **imap-worker, smtp-worker, account-worker, search-index-worker** poll the queues. They sync mail and push changes back to IMAP. They send what you write, and they index for search.
- **scheduler** enqueues a sync for every account on a timer, so mail arrives with no browser open.
- **queue** is a SQLite-backed sidecar speaking the SQS wire protocol.

All relational state, messages, accounts and identities included, lives in one SQLite file; the vector store keeps a second one. Message bodies are a disk cache and re-sync from IMAP, so the two database files are the whole state worth protecting.

## The boundaries are contracts

The queue speaks the SQS wire protocol. Storage sits behind `@remit/data-ports`: repository interfaces, error classes and a conformance suite. No file in that contract names a database or an ORM. Reader ships the SQLite adapter. An adapter for another engine implements the same ports and passes the same suite, in the repository that deploys it. A self-host build has no cloud SDK and no second database driver. The check for that runs on the produced bundle.

This is why the stack is portable. The services never learn which cloud they run on, or that they run on none.

## One source of truth, twice

The API and the database schema are generated from TypeSpec; nothing hand-writes what the `.tsp` files define. On the mail side, the IMAP server is the source of truth and the local database is a projection of it. Every operation that changes server state follows the [mutation rules](../mutations/).

## Tested against a real server

The end-to-end suite runs the whole stack against a real IMAP server (Dovecot, in a compose file) and a real SMTP sink. Tests assert what the server holds, and the web client is what drives it. What the suite proves is what an install does.

Deeper reading: [sync](../sync/), [search and classification](../search-and-classification/), and in the repository, `docs/architecture/backend-adapters.md` and `docs/architecture/url-state.md`.
