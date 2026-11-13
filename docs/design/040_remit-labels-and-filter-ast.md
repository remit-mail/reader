# Remit labels and a filter rule language

RFC 040. Status: proposed, 2026-11-13. Design only. Nothing here is built.

## Goal

A user with more than one mail account gets one set of labels and one set of filters for every account. Each label is a real IMAP folder in every account. A filter sorts mail inside the account it arrived in. Filters get a richer rule language, an order, and a test on the classifier's answer. Agents read the classifier's answer and the authentication results through MCP.

Every filter and label operation is an IMAP operation within one account. Mail never moves between servers or accounts.

## Labels

### The root folder

Remit claims one root folder per account, directly under INBOX, named `<prefix>_remit`. The prefix is four random characters and one check character, all from the RFC 4648 base32 alphabet in lower case: `abcdefghijklmnopqrstuvwxyz234567`. A character's code point is its position in that string, so `a` is 0 and `7` is 31.

The check character is Luhn mod 32. Walk the four random characters from right to left. Multiply the first by 2, the next by 1, and keep alternating. Write each product as `floor(p / 32) + p % 32` and add these up. The check code point is `(32 - sum % 32) % 32`. To validate, walk all five characters the same way, with factor 1 on the check character. The sum mod 32 must be 0, and the name must end in `_remit` after the prefix.

### Discovery

Every folder sync reads the mailbox rows of the children of INBOX, pending creates included. A child that passes the check is a candidate. One candidate is the root. With no candidate, Remit generates a prefix and creates the folder through the mailbox create mutation (`docs/architecture/imap-mutations.md`). With more than one, Remit takes the first in byte order and records a sync warning. A fresh install finds the root this way.

### Labels per account

A label is a `Label` row, one per user, keyed by `accountConfigId` as today. In each account it maps to one child folder of the root. The mailbox row of that folder carries the `labelId`. Folder sync matches a child of the root to the label whose `normalizedName` equals the child's case-folded name. The `/accounts/{accountId}/labels` operations and `MessageLabel` keep working on the same rows.

`create_label` creates the `Label` row and its folder in every account through the mailbox queue. Remit creates label folders at no other time.

### Rejected

1. A hidden marker message that records the root.
2. A filter that moves mail from one account to another.
3. IMAP METADATA. The byte-order tiebreak already makes discovery deterministic. The imapflow 2.9.1 client has no METADATA API.

## Filters

### Two kinds

A per-account filter moves mail into a folder by `actionMailboxId`. Every filter that exists today is one, and it keeps working unchanged. A cross-account filter sets `actionLabelId` to a label with folders. Remit moves the mail into that label's folder in the arrival account. A cross-account filter skips an account whose folder is missing or still pending, as `appliesTo` does today. Create refuses a filter that holds both kinds of move.

Both kinds stay rows of the `Filter` entity, keyed by `accountConfigId`. Filters act on Junk arrivals and their move beats placement (#1568).

### The rule

The grammar follows Sieve (RFC 5228). Remit stores the rule's test as its own JSON AST and runs it on its own engine in `packages/mailbox-service/src/filters`. The actions stay columns.

```ts
type Rule = { version: 1; test: Test };

type Test =
  | { test: "allof"; tests: Test[] }
  | { test: "anyof"; tests: Test[] }
  | { test: "not"; operand: Test }
  | { test: "header"; match: Match; header: "from" | "subject" | "list-id"; key: string }
  | { test: "address"; match: Match; part: AddressPart; key: string }
  | { test: "hasWords"; words: string[] }
  | { test: "classification"; label: ClassificationLabel };

type Match = "is" | "contains";
type AddressPart = "all" | "localpart" | "domain" | "registrableDomain";
```

Each leaf holds one header and one key, and `anyof` covers a list. The `address` test reads `from` only, because `thread_message` stores no `to` or `cc`. Sync already stores these fields, so the organize job can test them over old mail. Remit normalizes a `list-id` value as `normalizeListId` does today. TypeSpec caps the leaves of a rule with `@maxItems`. The TypeSpec enums spell the `match`, `header` and `part` members in PascalCase (`Is`, `From`, `ListId`, `RegistrableDomain`), as every enum in the API does.

### Classification test

`classification` matches when the classifier gave that label a confident score. The classifier learns a new label, `ColdOutreach`, and `MessageCategory` adds `coldOutreach`. The test reads a new `Message.classifierScores` field, which defaults to an empty list. Each score holds `label`, `confidence` and `confident`. Remit sets `confident` at write time from `CONFIDENCE_THRESHOLD` in `classifier-precedence.ts`, which depends on the answer's `confidenceKind`. A message with no scores fails every classification test.

Body sync consults the classifier only when no filter matched. When any active filter has a classification leaf, the classifier runs before filters, under the same `classifierGate`.

### Priority and stop

`Filter` adds `priority`, an integer that defaults to 0. Lower runs first, ties go to the newest `actionChangedAt`, then to `filterId`. The first move a message reaches wins, and later moves do nothing. Tags add up. `Filter` also adds `stop`, a boolean that defaults to false. A filter with `stop` ends evaluation for that message after its own actions. Migrated filters share priority 0 and carry no `stop`, so they behave as `selectMoveWinner` does now.

### Migration

`Filter` and `OrganizeJobRequest` each gain a `rule` column whose default is `{"version":0}`. In a version 0 row the clause columns are the truth. In a version 1 row `rule` is the truth, and the repository writes `[]` to the clause column. The repository turns a version 0 row into a version 1 test when it reads it:

1. `matchOperator` And becomes `allof`, and Or becomes `anyof`. Each clause becomes one leaf.
2. `From` and `Subject` become `header` tests with `contains` on their own header. `ListId` becomes one with `is` on `list-id`.
3. `FromDomain` becomes an `address` test with `registrableDomain` and `is`.
4. `HasWords` becomes a `hasWords` test.

Any write through either API stores version 1. Every migration adds a column with a constant default.

### Compatibility layer

`create_filter`, `update_filter` and `/accounts/{accountId}/filters` take either a `rule` field or the clause fields. A rule of leaves under one `allof` or `anyof` maps back to clauses, and reads return the clause fields for such a rule. A rule that maps to no clause list reads with empty `literalClauses`, so `Filter.literalClauses` drops `@minItems(1)`. Update refuses a clause edit to such a filter and points the caller at `rule`.

The narrowing query that `ruleNarrowing` builds reads only the rule's top node and its direct children. A single leaf, or the leaf children of an `allof` or `anyof`, becomes the flat term list that `listByFieldTerms` takes, as an and-query or an or-query. In an `allof`, a child that cannot narrow (a nested node, a `not` or `hasWords`) is skipped and its siblings' terms are kept, because and-ing a subset of the terms returns a superset of the matches. An `anyof` with such a child narrows nothing, and so does a top `not`. A `not` never becomes a positive term.

### Which account lists a filter

`list_filters` reads all filters with `listByAccountConfig` and drops `continuationToken`. For an account it returns the per-account filters whose `actionMailboxId` folder that account owns, as `resolveAccountId` reports. It also returns every cross-account filter, and every filter with no move.

## Agent tools

Each message in `list_threads`, `search_threads` and `get_thread` carries two new objects:

```ts
classification: { category: MessageCategory; scores: { label: ClassificationLabel; confidence: number; confident: boolean }[] };
auth: { dmarc: AuthResultVerdict; spf: AuthResultVerdict; dkim: AuthResultVerdict };
```

These fields live on `Message`, and `ThreadMessage` rows lack them.

`GET /classification-stats` and the MCP tool `classifier_stats` report the classifier's distribution and its corrections since a date:

```ts
type ClassifierStats = {
  since: string; // ISO 8601 with offset
  examined: number;
  byCategory: { category: MessageCategory; count: number }[];
  byLabel: { label: ClassificationLabel; count: number }[]; // confident scores
  corrections: { spamReportedNotJunk: number; categoryOverridden: number };
};
```

A correction is a spam report on mail the classifier did not call junk, or a sender `Address.flags.category` override. Latency and failure counts stay in `packages/logger`, as `docs/architecture/storage.md` requires.

Two label tools join the MCP server. `list_labels` returns each label with the `mailboxId` of each of its folders. `create_label` creates a label as the Labels section describes.

## Delivery order

Each stage is one PR. Each stage adds only its own members of the `Test` union.

1. Cold outreach: `ColdOutreach` and `coldOutreach`, plus `Message.classifierScores`. Packages: `typespec`, `data-ports`, `drizzle-service`, `mailbox-service`.
2. MCP metadata on the three thread tools. Packages: `mcp-server`, `data-ports`.
3. Classifier stats endpoint and tool. Packages: `typespec`, `backend`, `drizzle-service`, `mcp-server`.
4. The rule AST and engine with `allof`, `anyof`, `not`, `header`, `address` and `hasWords`: the `rule` column, the read-time migration, and narrowing. Packages: the four of stage 1, plus `backend`, `config-format` and `config-transfer`. The config document's `FilterSchema` requires a clause and has no `rule`, so export breaks on a version 1 rule until this stage changes it. reader-cloudflare's `smoke:config-import` reads that document.
5. Priority and `stop`. Packages: `typespec`, `drizzle-service`, `mailbox-service`, `config-format`.
6. The `rule` field on the filter API and MCP tools, with the compatibility layer. Packages: `typespec`, `backend`, `mailbox-service`, `mcp-server`.
7. The `classification` test, after stages 1 and 4. Package: `mailbox-service`.
8. Root discovery and the prefix check. Package: `mailbox-service`.
9. Label folders, `labelId` on mailbox rows, and the two label tools. Packages: `mcp-server`, `mailbox-service`, `drizzle-service`, `typespec`.
10. Cross-account filters and `list_filters` scoping. Packages: `mailbox-service`, `backend`, `mcp-server`.

## Open questions

1. HasWords: which fields it searches, and whether it reads the body. Today every word must occur in the sender's email, the sender's name, the subject or the body.
2. Mail from friends on one.com-hosted domains flags as a From/sender mismatch. An open heuristic accepts the mismatch when the From domain's SPF includes one.com or its MX points there, and the sender has prior correspondence with the user. The heuristic belongs to placement (#1304, #1553).
3. Duplicate filters: a warning when two filters match the same mail is deferred.
4. Whether a label made through `/accounts/{accountId}/labels` gets folders, or stays a database tag with no folders.
