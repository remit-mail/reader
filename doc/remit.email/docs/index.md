---
title: Reader
description: Mail on your own hardware, as a client over the mailbox you already have.
---

# Reader

An email client you run yourself. It connects to the IMAP/SMTP mailbox you already have, keeps a local copy of your mail, and serves a fast web app to read, search and send from. IMAP stays the source of truth. Reader is a client over your mailbox; your mail keeps living where it lives today. You migrate nothing, and turning Reader off costs you nothing.

The software that reads your mail stays on your hardware too. Classification and semantic search are computed on the box that runs Reader. Message content goes to your mail server over IMAP and SMTP, and nowhere else.

## What you get

- A web mail client: reading, threading, search, compose, account settings.
- A local classifier that sorts messages: personal, newsletter, marketing, automated, transactional, social.
- Full-text search, and semantic "find similar" over locally computed embeddings.
- A single-VM deployment: everything in SQLite files on one disk, no database server to run.
- Your IMAP credentials encrypted at rest with a key only you hold.
- Versioned releases. An update shows up in the app, you install it with a click, and a failed update rolls itself back.

## Run it

One command on a Linux box with Docker and Compose v2:

```
curl -fsSL https://raw.githubusercontent.com/remit-mail/reader/main/install.sh \
  | bash -s -- --origin https://mail.example.com
```

A 2 vCPU / 4 GB box is enough. [Install](getting-started/install/) walks through it, TLS options included.

## Where to go next

- [Getting started](getting-started/install/): install, add your first account, stay current.
- [Architecture](architecture/overview/): how the pieces fit, and the rules that keep IMAP the source of truth.
- [Operations](operations/deployment/): running it, backing it up, updating it.
- [Security](security/): the model as it stands, and what is still planned.
- [Roadmap](roadmap/): where this is going.

Reader is MIT licensed, and the open core of a larger system. The repository holds everything needed to run it on a single machine.
