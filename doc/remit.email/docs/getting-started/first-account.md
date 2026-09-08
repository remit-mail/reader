---
title: Your first account
description: Sign up, add your mailbox, and let the first sync run.
---

# Your first account

Open the URL the installer printed. The first sign-up on that page creates your account on the instance. This is your Reader identity; your mailboxes hang under it.

Add a mailbox from **Settings -> Add account** with your IMAP and SMTP details: host, port, username, password. Your provider lists these on a help page. A provider that requires OAuth instead of a password works too: the operator sets `MSOAUTH_CLIENT_ID` and `MSOAUTH_CLIENT_SECRET` in `.env` for Microsoft sign-in through Entra.

## What happens next

The workers sync your mailbox: folders first, then message headers, then bodies into a local cache. A large mailbox takes a while to index; you can read and send before that finishes.

From then on the scheduler fetches every account on a timer, fifteen minutes by default, so mail arrives with no browser open. Loading the client or pressing sync fetches sooner. [Sync](../../architecture/sync/) explains the cadence and how to tune it.

## What Reader writes to your mailbox

Reader reads your mailbox to build its local copy. It writes only when you act: flag, move, delete, send, and the filing rules you create in Organize. Every one of those goes through the [mutation rules](../../architecture/mutations/): the server confirms the change before Reader treats it as done.

Your mailbox stays usable from every other client you have. Reader is one more client on the same IMAP account, and it re-syncs whatever the others change.
