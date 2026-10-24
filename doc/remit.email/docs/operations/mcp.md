---
title: MCP connector
description: Let claude.ai and Claude Code read your mail, on a host of its own.
---

# MCP connector

The connector lets an MCP client read your mail on your own instance. claude.ai and Claude Code are the two clients set up below. A client signs in with your remit password, you allow it, and it gets a token that works on the connector and nowhere else.

The connector is off by default. It runs in its own container and answers on its own origin, such as `https://mcp.example.com`. That origin can be a different domain from your instance. While it is off, nothing answers there.

## Turn it on

1. Give the connector a hostname. Point its DNS at the box the way the instance's own name points there. Under `--tls-mode tunnel`, add it as a second public hostname on the same tunnel, routed to `http://caddy:80`.
2. Run:

   ```bash
   remit mcp enable https://mcp.example.com
   ```

   This sets `MCP_PUBLIC_ORIGIN`, generates `MCP_AUTH_SECRET`, adds `mcp` to `COMPOSE_PROFILES` and restarts. Caddy gets a certificate for the new name in the `acme` and `internal` modes. Under `tunnel` the certificate stays at Cloudflare.

The origin must be `https://` in every mode except `off`. claude.ai connects from Anthropic's servers, so for claude.ai the host must also be reachable from the internet.

To turn it off:

```bash
remit mcp disable
```

The container goes and the origin is cleared. Client registrations and tokens stay in the database, so turning it back on restores existing connections.

## claude.ai

1. Open **Settings → Connectors → Add custom connector**.
2. Enter the URL `https://mcp.example.com/mcp`. Leave the OAuth client fields empty: claude.ai registers itself.
3. Connect. A remit sign-in page opens on your MCP host. Sign in, then allow the access it asks for.

## Claude Code, with a browser

```bash
claude mcp add --transport http remit https://mcp.example.com/mcp
```

Then run `/mcp` inside Claude Code and pick `remit`. A browser opens on the sign-in page. Sign in and allow. Claude Code keeps the token and refreshes it.

## Claude Code, headless

On a machine with no browser, use the device code flow:

```bash
remit mcp login
```

It prints a short code and a URL. Open the URL on any device, sign in, and enter the code. The command then prints a `claude mcp add --header` line carrying the token. Run that line on the headless machine.

## Cloudflare settings for the MCP host

Cloudflare sits between the client and the connector when the host is proxied through it, and always under `--tls-mode tunnel`. Its defaults break the OAuth flow and the MCP transport in several ways. Set these for the MCP hostname only. The instance's own hostname keeps its own settings.

| Setting | Value | Why |
|---|---|---|
| Caching | A Cache Rule that bypasses the cache for the hostname | The metadata documents, tokens and tool results are per-request. A cached answer hands one client another client's response. |
| Bot Fight Mode, Super Bot Fight Mode, challenges | Off for the hostname, or a WAF skip rule for it | claude.ai calls from Anthropic's servers and Claude Code calls from a terminal. Neither can solve a challenge page. |
| Cloudflare Access | No Access application on the hostname | Access answers with its own login page. The connector does its own sign-in with OAuth, which a client cannot complete behind Access. |
| WAF | No managed or custom rule that blocks `POST` with a JSON body | Every MCP request is a JSON `POST` to `/mcp`, and registration and token exchange are `POST`s too. |
| Request and response headers | No Transform Rule that removes `Authorization` or `WWW-Authenticate` | `Authorization` carries the token. `WWW-Authenticate` on a 401 tells the client where to sign in. |
| Buffering | No Worker or rule that buffers the response, and no response compression rewrite on `text/event-stream` | The MCP transport may stream its answer as server-sent events. A buffered stream reaches the client only when it ends. |

Caddy replaces any `X-Remit-Client-IP` a client sends with the address Cloudflare reports in `Cf-Connecting-Ip`. The sign-in rate limit then counts each client on its own address.
