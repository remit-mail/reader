---
title: Search and classification
description: Everything that reads your mail runs on the box that stores it.
---

# Search and classification

Reader classifies and indexes your mail on the machine it runs on. No third party reads your message content.

## Classification

Every synced message gets a category: `personal`, `newsletter`, `marketing`, `automated`, `transactional`, `social`, or `uncategorized` when nothing matches. The daily brief groups on these, and the inbox filters on them.

The classifier is a set of header heuristics. It reads list headers, sender patterns and the provider's own spam verdict. A list of common transactional and social domains rounds it out. It runs during body sync, on the box. Each message records whether the classifier reached it.

The same pass reads the DKIM, SPF and DMARC results. It compares the DKIM signing domain against the From domain. A mismatch surfaces in the intelligence sidebar as a phishing verdict. Absence of a signature means no signal, and the UI says so instead of guessing.

## Full-text search

Text search is FTS5, SQLite's own full-text engine, over subjects and senders. It needs no configuration and no extra service.

## Semantic search

The `search-index-worker` computes an embedding for each message with a local model. The vectors land in the SQLite vector store. Each chunk's content hash folds in the model identifier, so a model change re-embeds what it invalidates and nothing else.

What those vectors serve today is "find similar": the Organize widen reads them and works. The self-host build does not yet serve free-text semantic queries. Its backend image ships without the query-side runtime, so `/search/semantic` returns empty results. Closing that gap is on the [roadmap](../../roadmap/).

## The contract underneath

Search sits on the storage contract like everything else. The portable floor is verbatim substring matching. Case and diacritic folding are each adapter's own behaviour. The conformance suite asserts the floor and nothing more. `docs/architecture/backend-adapters.md` explains the choice: a stricter floor fails adapters the contract intends to admit.
