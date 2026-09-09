---
title: Sync
description: A scheduler ticks, workers pull, and the mutator rules push changes back.
---

# Sync

Sync is pull. Nothing on your mail server needs to know Reader exists: no push subscriptions, no server-side plugins, plain IMAP.

## Cadence

The `scheduler` service enqueues a sync for every account whose last sync is older than `MAILBOX_SYNC_OFFLINE_INTERVAL_SECONDS` (900 by default), checking every `MAILBOX_SYNC_TICK_INTERVAL_SECONDS` (300). That is what fetches mail when no browser is open. Every other trigger is a person: loading the client, pressing sync, connecting an account.

Fifteen minutes is where desktop mail clients sit. Lower it for fresher mail at the cost of one more IMAP login per account per cycle; a server that rate-limits logins is the reason to stay near the default.

## What a sync does

A sync walks the account's folders, reconciles the local projection against what the server lists, and fetches new message headers. Bodies follow in a second pass into a disk cache, where the classifier reads them. The cache is disposable: bodies re-sync from IMAP, which is why backups skip them.

Changes made elsewhere flow in the same way. Reader shares the mailbox with every other client you use; a flag set in another client, or a rule your provider runs, shows up on the next sync.

## Pushing back

Changes made in Reader (flags, moves, deletes, sends, filing rules) go out through queue workers under the [mutation rules](../mutations/): the local row is marked pending, a worker performs the IMAP operation, and the row settles when the server confirms. The projection never claims something the server has not said yes to.

## Knowing it works

Each worker writes a heartbeat file every poll cycle; a container is marked unhealthy once its oldest heartbeat is older than the threshold, seven minutes for the workers. A healthy worker means its loops are turning. Whether the work succeeds is a different question, and `remit doctor` answers it: it reports `account_sync_stalled` off the real sync age, per account. See [deployment](../../operations/deployment/).
