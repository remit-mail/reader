---
title: Security
description: What protects your mail today, what leaves the box, and what is still planned.
---

# Security

Reader's security model starts from where it runs: your box, your mailbox, your key. No admin role sits above you, and no vendor account sits behind you.

## The boundary

One origin serves everything. Caddy terminates TLS and publishes the only host ports; every API request passes an edge gate that verifies the identity JWT before it reaches the backend. The stack pins sessions and tokens to that one origin.

Sign-up is open only as long as you leave it open. The intended shape is: create your account, then set `SELF_SIGN_UP_ENABLED=false`.

## Secrets

Two secrets carry the deployment. `BETTER_AUTH_SECRET` signs the identity JWTs. `FAKE_KMS_DATAKEY` encrypts every stored mailbox credential at rest, and only you hold it: the installer generates it into a `.env` with mode 600, and it exists nowhere else. Back it up; losing it means re-entering each account's credentials.

`remit config` prints the configuration as the stack sees it, with secrets redacted, so a support paste does not leak them.

## What leaves the box

Message content moves between your box and your mail server, over IMAP and SMTP. The box computes classification and search embeddings itself, so no third party reads your mail. Beyond your mail server, the stack calls out for container images, for the update manifest, and to whatever alert webhook you configure. Under `--tls-mode tunnel`, traffic to your browser passes Cloudflare's edge; every other TLS mode keeps that path direct.

The logs hold the same line: a message body, a subject or a sender never gets a log field of its own. A sender can still surface inside an error message or a stack trace on a failure line.

## Updates

An update installs only with consent: a click in the app or a command at a shell. The manifest is the only discovery channel. The updater refuses a version at or below the running one, and refuses a manifest naming images outside its own registry. A failed update rolls itself back. Details in [updating in depth](../operations/updating/).

## Planned

Per-user data encryption is on the [roadmap](../roadmap/): today your key encrypts the credentials at rest, the box itself protects the stored mail, and the direction is per-user keys over that mail as well. Until then, disk encryption on the host is the honest answer for data at rest.

## Reporting

For anything with a security impact, report privately instead of opening a public issue. Ordinary bugs go to the issue tracker with steps to reproduce.
