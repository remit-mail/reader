---
title: IMAP mutations
description: The server confirms every change before Reader believes it.
---

# Mutation rules

An IMAP mutation is any operation that changes state on the remote mail server: folder create, rename, delete; message move, copy, delete, flag; append. The remote server is the source of truth and the local database is a projection of it. A mutation is done when the server has confirmed it. A written local row proves nothing yet.

Two rules govern every mutation in the codebase. The binding text is `docs/architecture/imap-mutations.md` in the repository; this page is the short version.

## R1: every mutation uses the mutator pattern

1. Write the local record with a pending marker.
2. Enqueue the remote operation.
3. A worker performs it and writes back the settled state: `synced`, with the server's canonical values, or `failed`.

No fire-and-forget writes to the server. No local state that claims server truth before confirmation. A reconcile sweep treats a pending record as in-flight; it never deletes or rebuilds one whose mutation has not settled.

Deleting its own record is also a way a mutation settles. A send appends the message to Sent and then drops the outbox row, so the delete is the confirmation. Where a flow designs it that way, readers treat the record's absence as the confirmed outcome.

## R2: dependent operations choose, in writing

Any operation that reads or references a record with a pending mutation picks one of two models, and the choice is stated in the PR or design doc:

- **Wait**: block until the mutation settles, then bind to the confirmed record. Failure surfaces before the dependent write exists.
- **Reconcile**: bind optimistically. Ship the repair path that fixes the reference when confirmation changes the record, as part of the same change.

Dependent writes wait by default. Waiting costs seconds, once. Reconciliation costs correctness forever after: every missed repair path is a dangling-reference bug. Independent reads can show pending state, labeled as pending.

## Why the rules exist

A filter once bound to a folder row while the folder's create was still in flight. The server normalized the path, reconcile replaced the row, and the filter pointed at a deleted record. Both halves of that failure are what R1 and R2 forbid: the reconcile treated a pending row as absent, and the filter bound without a wait-or-reconcile decision. Fixed across v0.2.4, and the rules have been mandatory since.
