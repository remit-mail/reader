---
title: Install
description: One command on a Linux box with a container engine.
---

# Install

You need a Linux box (amd64) with Docker or Podman and the Compose v2 plugin, version 2.30 or newer. Point the installer at the URL you will load the app from:

```
curl -fsSL https://raw.githubusercontent.com/remit-mail/reader/main/install.sh \
  | bash -s -- --origin https://mail.example.com
```

The installer checks the host before it changes anything. The checks cover the container engine, the Compose version, amd64, and free ports. Then it downloads the compose stack into `./reader`, generates your secrets into a `.env` with mode 600, and brings everything up. It takes no input while it runs. When it finishes it prints the URL to open.

Every auth and CORS origin derives from `--origin`, so a wrong origin surfaces later as a failed sign-in. Pasted unedited, the installer refuses the placeholder.

`--dry-run` runs the host checks, writes the config and validates the compose file without pulling an image or starting anything. `--help` lists every flag.

## TLS

`--tls-mode` picks how Caddy serves the app:

| mode | what it does |
|---|---|
| `internal` (default) | HTTPS with Caddy's own CA. No external dependency; browsers warn until you trust the root certificate. |
| `off` | Plain HTTP. Reach it over a private network: a tailnet, a VPN, an SSH tunnel. |
| `tailscale` | A real certificate through the local `tailscaled`, for this box's tailnet name. |
| `acme` | Public Let's Encrypt. Needs public DNS and ports 80/443 reachable. |
| `tunnel` | TLS at Cloudflare's edge, over a connection the box opens outbound. No public IP needed. |

The [VPS deployment guide](../../operations/deployment/) sets up each mode step by step.

## After the install

The first sign-up on the printed URL creates your account. Then [add your mailbox](../first-account/), and close sign-up:

```bash
sed -i 's/^SELF_SIGN_UP_ENABLED=.*/SELF_SIGN_UP_ENABLED=false/' .env
remit restart
```

## Back up the key

The installer writes `FAKE_KMS_DATAKEY` into `.env`: the key that encrypts every stored mailbox credential. No other copy exists. Back it up. Lose it and you re-enter each account's credentials.

Re-running the installer is safe: it keeps an existing `.env` and never regenerates a secret that already has a value.
