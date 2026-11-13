# Remit labels and a filter rule language

RFC 040. Status: proposed, 2026-11-13. Design only. Nothing here is built.

## Goal

A user with more than one mail account gets one set of labels and one set of filters for every account. Each label is a real IMAP folder in every account. A filter sorts mail inside the account it arrived in, and it can rescue mail the provider marked as spam. Filters get a richer rule language, an order, and a test on the classifier's answer. Agents read the classifier's answer and the authentication results through MCP.

Every filter and label operation is an IMAP operation within one account. Mail never moves between servers or accounts.

## Labels

### The root folder

Remit claims one root folder per account, directly under INBOX, named `<prefix>_remit`. The prefix is four random characters and one check character, all from the RFC 4648 base32 alphabet in lower case: `abcdefghijklmnopqrstuvwxyz234567`. A character's code point is its position in that string, so `a` is 0 and `7` is 31.

The check character is Luhn mod 32. Walk the four random characters from right to left. Multiply the first by 2, the next by 1, and keep alternating. Write each product as `floor(p / 32) + p % 32` and add these up. The check code point is `(32 - sum % 32) % 32`. To validate, walk all five characters the same way, with factor 1 on the check character. The sum mod 32 must be 0, and the name must end in `_remit` after the prefix.

### Discovery

Every folder sync lists the children of INBOX. A child that passes the check is a candidate. One candidate is the root. With no candidate, Remit generates a prefix and creates the folder through the mailbox create mutation (`docs/architecture/imap-mutations.md`). With more than one, Remit takes the one METADATA names, else the first in byte order, and records a sync warning. A fresh install finds the root this way from the server alone.

### Labels per account

A label is the name of a child folder of the root. Two accounts with a child of the same case-folded name hold the same label. The mailbox rows that folder sync already writes are the mapping from label to folder, one row per account. The `Label` and `MessageLabel` entities keep their current meaning: tags stored in the database.

Creating a label creates its folder in every account. Renaming one renames the folder in every account and rewrites the filters that name it. When a filter targets a label that an account lacks, Remit creates the folder first, and the move waits for that create to settle.

### Server metadata

When a server advertises METADATA (RFC 5464), Remit writes the root folder's name to the server entry `/private/vendor/remit/root`. Discovery reads that entry before it lists folders.

### Rejected

1. A hidden marker message that records the root.
2. A filter that moves mail from one account to another.

## Filters

### Two kinds

A per-account filter moves mail into a folder by `mailboxId`. Every filter that exists today is one, and it keeps working unchanged. A cross-account filter files mail into a Remit label. Remit resolves the label to its folder in the account the mail arrived in. One rule cannot hold both kinds of move, and create refuses it.

Both kinds stay rows of the `Filter` entity, keyed by `accountConfigId`.

### The rule

The grammar follows Sieve (RFC 5228). Remit stores the rule as its own JSON AST and runs it on its own engine in `packages/mailbox-service/src/filters`.

```ts
type Rule = { version: 1; test: Test; actions: Action[] };

type Test =
  | { test: "allof"; tests: Test[] }
  | { test: "anyof"; tests: Test[] }
  | { test: "not"; operand: Test }
  | { test: "header"; match: Match; headers: string[]; keys: string[] }
  | { test: "address"; match: Match; part: AddressPart; headers: string[]; keys: string[] }
  | { test: "hasWords"; words: string[] }
  | { test: "classification"; label: ClassificationLabel };

type Match = "is" | "contains";
type AddressPart = "all" | "localpart" | "domain" | "registrableDomain";

type Action =
  | { action: "fileinto"; mailboxId: string }
  | { action: "fileintoLabel"; label: string }
  | { action: "tag"; labelId: string }
  | { action: "stop" };
```

The `header` test reads `from`, `subject` and `list-id`. The `address` test reads `from`, `to` and `cc`. Sync already stores these fields, so the organize job can test them over old mail. Remit normalizes a `list-id` value as `normalizeListId` does today.

### Classification test

`classification` matches when the classifier gave that label a confident score. `CONFIDENCE_THRESHOLD` in `classifier-precedence.ts` sets the thresholds. The classifier learns a new label, `ColdOutreach`, and `MessageCategory` adds `coldOutreach`. The test reads a new `Message.classifierScores` field, which defaults to an empty list. Today `classifierVerdict` reduces the classifier's answer to one verdict and drops the scores, so no store holds them. A message with no scores fails every classification test.

### Priority and stop

`Filter` adds `priority`, an integer that defaults to 0. Filters run in ascending priority. Ties run the newest `actionChangedAt` first, then by `filterId`. The first move a message reaches wins, and later moves do nothing. Tags add up. `stop` ends evaluation for that message after its own actions. Migrated filters share priority 0 and carry no `stop`, so they behave as `selectMoveWinner` does now.

### Migration

`Filter` and `OrganizeJobRequest` each gain a `rule` column whose default is `{"version":0}`. Version 0 means the row's clause and action columns are its rule. The repository turns such a row into a version 1 rule when it reads it:

1. `matchOperator` And becomes `allof`, and Or becomes `anyof`.
2. `From` and `Subject` become `header` tests with `contains` on their own header. `ListId` becomes one with `is` on `list-id`.
3. `FromDomain` becomes an `address` test on `from` with `registrableDomain` and `is`.
4. `HasWords` becomes a `hasWords` test.
5. `actionMailboxId` becomes `fileinto`, and `actionLabelId` becomes `tag`.

Any write through either API stores version 1. The migration only adds the column.

### Compatibility layer

`create_filter`, `update_filter` and `/accounts/{accountId}/filters` take either a `rule` field or the clause fields. Every clause write also stores the rule it maps to. Reads return the clause fields whenever the rule maps back to them. A rule that maps to no clause list reads with empty `literalClauses`. Update refuses a clause edit to such a filter and points the caller at `rule`.

The narrowing query that `literalClauseTerms` builds today walks the rule instead. `allof` gives an and-query and `anyof` an or-query. `not`, `hasWords` and `classification` narrow nothing. Durable Object SQLite binds up to 100 parameters per statement. A rule with more terms than the host's `maxBoundParameters` allows narrows nothing, and the engine filters the full corpus instead.

### Which account lists a filter

`list_filters` for an account returns the per-account filters whose `fileinto` folder that account owns, as `resolveAccountId` reports. It also returns every cross-account filter, and every filter with no move.

## Spam rescue

A filter can move mail out of Junk, because `filtersForArrival` already runs filters on Junk arrivals. Such a move needs `dmarc` Pass in `Message.authResult`. When DMARC did not pass, the move is skipped and the message stays in Junk.

Known issue: mail from friends on one.com-hosted domains flags as a From/sender mismatch.

## Agent tools

Each message in `list_threads`, `search_threads` and `get_thread` carries two new objects:

```ts
classification: { category: MessageCategory; scores: { label: ClassificationLabel; confidence: number }[] };
auth: { dmarc: AuthResultVerdict; spf: AuthResultVerdict; dkim: AuthResultVerdict };
```

These fields live on `Message`, and `ThreadMessage` rows lack them. The tools fetch the page's `Message` rows in batches that fit the host's parameter limit.

`GET /classification-stats` and the MCP tool `classifier_stats` report the classifier's distribution and its corrections since a date:

```ts
type ClassifierStats = {
  since: string; // ISO 8601 with offset
  examined: number;
  byCategory: Record<MessageCategory, number>;
  byLabel: Record<ClassificationLabel, number>; // confident scores
  corrections: { spamReportedNotJunk: number; categoryOverridden: number };
};
```

A correction is a spam report on mail the classifier did not call junk, or a sender `Address.flags.category` override. Latency and failure counts stay in `packages/logger`, as `docs/architecture/storage.md` requires.

Three label tools join the MCP server. `list_labels` returns each label with the `mailboxId` of each of its folders. `create_label` and `rename_label` create and rename folders through the mailbox queue.

## Delivery order

Each stage is one PR.

1. Cold outreach: `ColdOutreach` and `coldOutreach`, plus `Message.classifierScores`. Packages: `typespec`, `data-ports`, `drizzle-service`, `mailbox-service`.
2. MCP metadata on the three thread tools. Packages: `mcp-server`, `data-ports`.
3. Classifier stats endpoint and tool. Packages: `typespec`, `backend`, `drizzle-service`, `mcp-server`.
4. The rule AST and engine: the `rule` column, the read-time migration, and narrowing. Packages: the four of stage 1.
5. Priority and `stop`. Packages: `typespec`, `drizzle-service`, `mailbox-service`.
6. The `rule` field on the filter API and MCP tools, with the compatibility layer. Packages: `typespec`, `backend`, `mailbox-service`, `mcp-server`.
7. The classification test, after stages 1 and 4. Package: `mailbox-service`.
8. Root discovery, the prefix check and METADATA. Package: `mailbox-service`.
9. Label folders and the three label tools. Packages: `mailbox-service`, `mcp-server`.
10. Cross-account filters and `list_filters` scoping. Packages: `mailbox-service`, `backend`, `mcp-server`.

## Open questions

1. HasWords: which fields it searches, and whether it reads the body. Today every word must occur in the sender's email, the sender's name, the subject or the body.
2. The one.com mismatch. An open heuristic accepts the mismatch under two conditions. The From domain's SPF includes one.com or its MX points there. The sender also has prior correspondence with the user.
3. Duplicate filters: a warning when two filters match the same mail is deferred.
