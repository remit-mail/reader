---
title: Roadmap
description: Direction, stated plainly. Order and dates are decided when work starts.
---

# Roadmap

This page states direction. Nothing here carries a date, and nothing here changes what ships today: the [index](../) and the architecture pages describe only what exists.

## Mail on block storage

The direction is to re-imagine the email backend itself. Today message bodies are a disk cache over IMAP and relational state lives in SQLite. Where this goes is a backend with the mail itself on plain block storage: a store you can mount, snapshot and copy with the tools you already have, instead of a format only the mail software can read.

## Maildir as the interchange surface

Alongside that, maildir will become the export and interchange format. Whatever Reader stores will export as maildir. Every tool that has read maildir for twenty years will read it. The no-lock-in claim gets a file format you can verify.

## Per-user data encryption

Today a key only you hold encrypts your IMAP credentials at rest. That model will extend to the stored mail data itself, with per-user keys. Until then, host disk encryption covers data at rest.

## Semantic search, served

The self-host build already computes and stores embeddings for every message, and "find similar" runs on them. It does not yet serve free-text semantic queries. Serving them is next, with the query-side model running on the box like everything else.

## More deployment targets

The storage contract and the queue protocol exist so the services can move. What ships here is the single-VM SQLite deployment. AWS and European providers are the direction those contracts point at. An adapter lives in the repository that deploys it.
