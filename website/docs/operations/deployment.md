---
title: Deployment
description: One VPS today, driven by the remit wrapper; the contracts keep other targets open.
---

# Deployment

The supported target is one VPS: Docker Compose on a single amd64 box, sized for 2 vCPU and 4 GB. The images live at `ghcr.io/remit-mail/reader/*` and pull anonymously: no registry login to set up. The [install page](../../getting-started/install/) gets you there in one command; the full reference, TLS setup and Podman notes included, is `deploy/vps/README.md` in the repository.

## The remit wrapper

The installer ships `remit`, a wrapper that knows the install directory and the compose file in it:

```bash
remit status              # what is running, and whether the origin reaches it
remit doctor              # whether anything is wrong; non-zero when it is
remit logs [service…]     # follow the logs
remit restart             # apply an edit to .env
remit update              # install the current release, atomically
remit down                # stop serving; remit restart brings it back
remit config              # the effective configuration, secrets redacted
remit purge --yes         # destroy the deployment, data included
```

Apply an `.env` edit with `remit restart`. Compose's own `restart` reuses the old environment and still reports success. The wrapper instead runs `up -d`, recreating what changed.

`remit status` answers what is running. `remit doctor` answers whether anything is wrong: it runs the same checks the alerts fire on, names the accounts behind a stalled sync, and exits 0, 1 or 2, so a cron line makes it a monitoring check as it stands.

## Two deployments on one host

A second deployment is a project name and a port: `--project beta` names the containers, volumes and network, installs into its own directory, and puts `remit-beta` on PATH. `--http-bind` is the one host-level number two deployments must not share; the modes that publish 80 and 443 are one deployment per host.

## Podman

Podman works on one path only: rootful Podman driving real Compose v2 over its Docker-compatible socket. Never `podman-compose`: it silently drops `depends_on` conditions and ignores profiles, and the installer refuses it.

## Logs

Every service writes one JSON object per line to stdout. `level`, `time`, `service` and `msg` are always present, `requestId` correlates one handler invocation, and the field names are a contract that changes only with a release note. `remit logs backend | jq -c 'select(.level=="error")'` is the shape debugging takes.

## Other targets

Portability is deliberate. Storage sits behind the `@remit/data-ports` contract with a conformance suite, and the queue speaks the SQS wire protocol, so the same services run against any adapter and any queue: a VPS today, AWS, or a European provider. Reader ships the SQLite adapter; an adapter for another engine lives in the repository that deploys it. Nothing in the self-host image touches a cloud SDK, and a check on the produced bundle proves it. See the [architecture overview](../../architecture/overview/).
