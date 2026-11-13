# Remit spam and phishing filtering

RFC 041. Status: proposed, 2026-11-13. Design only. Nothing here is built.

## Goal

Remit decides itself whether a new message is spam or phishing. It moves a high-scoring message to Junk. A message in the uncertain band stays in place, with a warning to the owner. A spam service makes the call. The service is a judge: it weighs what the request presents and returns a score, an action and named reasons. It never goes out to collect evidence. Remit gathers the evidence and sends it in one request. That evidence includes sender history, the provider's verdict and the authentication results.

The check runs in three stages, cheapest first, and each stage can end it. Remit first lets known and trusted senders through without a call. The spam service then runs cheap checks on the message itself. A language model judges only the messages those checks leave undecided.

## The contract

### Request

Every piece of context is a field the caller fills in. The service never reads Remit's database. The shape follows rspamd's `/checkv2`: the raw message, plus envelope facts as named fields.

```ts
type SpamRequest = {
  message: {
    raw: string; // the RFC 822 message, base64
    headers: { name: string; value: string }[];
    text: string;
    html: string;
    links: { href: string; text: string }[];
  };
  envelope: {
    mailFrom: string; // Return-Path
    rcpt: string[]; // the account's own addresses
    ip: string; // from the receiving server's Received header, or empty
    helo: string; // likewise, or empty
  };
  authentication: {
    dmarc: AuthResultVerdict;
    spf: AuthResultVerdict;
    dkim: AuthResultVerdict;
    signerDomain: string; // `unverified` when no signature passed
    envelopeDomain: string;
  };
  provider: {
    verdict: "Spam" | "Clean" | "Absent";
    score: string; // empty when the header carries none
    headers: { name: string; value: string }[]; // X-Spam-* and the like
  };
  context: {
    knownSender: boolean; // the owner has sent mail to this address
    senderMessagesSeen: number; // earlier messages from this address
    senderDomainMessagesSeen: number; // earlier messages from its registrable domain
    senderDomainRegisteredAt?: string; // ISO 8601 from RDAP; absent when the registry publishes none
    classifierScores: ClassifierScoreItem[]; // the category classifier's answer, or empty
    modelAllowed: boolean; // the account has a model and is under its daily cap
  };
};
```

Remit parses the message once, so a backend needs no MIME parser. The raw message travels too, for a backend that does its own parsing. Remit fills the authentication fields with `extractAuthResult` and the provider fields with `extractProviderSpam`.

Remit fetches `senderDomainRegisteredAt` over RDAP while it gathers the evidence, in `mailbox-service`. It caches the answer in one row per registrable domain, because the date never changes. A registry that publishes no date leaves the field absent, and Remit never fills in a placeholder. DENIC's RDAP answer for a .de domain carries no registration event, so a missing date weighs lightly in the judge's score.

### Response

```ts
type SpamResponse =
  | {
      state: "Checked";
      score: number; // 0 to 1
      action: "None" | "Warn" | "Junk";
      kind: "Spam" | "Phishing";
      reasons: { name: string; score: number; options: string[] }[];
      modelCalled: boolean;
    }
  | { state: "Failed"; kind: SpamFailureKind };
```

The service compares the score with two thresholds to pick the action. Calibration sets both. `kind` is `Phishing` when the message impersonates someone, and `Spam` otherwise. A reason has the shape of an rspamd symbol: the check's name, what it added to the score, and what it found, such as the domain behind a link. `modelCalled` tells Remit to count the call against the daily cap.

### Backends

1. The inline engine runs inside Remit. Remit builds it as the default backend.
2. The rspamd adapter posts `message.raw` to `/checkv2`. It sends `envelope` as the `From`, `Rcpt`, `IP` and `Helo` headers. It drops `context`, which rspamd has no field for. Each symbol in the answer becomes a reason, and the adapter divides `score` by `required_score` to get the 0 to 1 score. Rspamd's `no action` maps to `None`, `add header` to `Warn`, and `reject` to `Junk`.
3. The spam Worker takes the same request as JSON over HTTPS. It serves the Cloudflare host, which never calls a VPS.

The backend is deployment config, as the category classifier's provider is.

## The pipeline

### Stage 1 screens out trusted mail, in Remit

Remit makes no call for a message in any of these cases:

1. The sender has the VIP or well-known flag. Well known means the owner replied to the sender, or three or more non-bulk messages arrived in the last 90 days (`packages/data-ports/src/wellknown.ts`).
2. The sender carries `neverSpam`.
3. One of the owner's filters matched the message.
4. The message is a newsletter from a known sender. It carries List-Unsubscribe, passes DMARC and comes from a sender with earlier mail. All three must hold, because a phisher can add an unsubscribe header too.

Report spam sets the sender's `blocked` flag, and a blocked sender goes straight to Junk with no call. That flag lives on the user's own `Address` row, so the list is per user and never pooled across a deployment. Detected spam never sets it, and the spam service never sees it. Every other message goes to the spam service.

### Stage 2 runs mechanical checks, in the service

The inline engine runs these checks as a pure function of the request, with no list of brands, providers or domains:

1. DMARC fails.
2. The Reply-To domain differs from the From domain.
3. A link's visible text shows a domain that differs from its href.
4. A link points to a domain far from the sender's, by edit distance.
5. A domain label is punycode or mixes scripts, or two domains in the message share a UTS #39 skeleton without being equal.
6. Rich HTML carries a single link or button, and it points to a domain other than the sender's.
7. A domain or the address's local part has high character entropy, as a generated name does.
8. The sender's domain has sent this account nothing before, or was registered recently.
9. The category classifier gave `Spam` or `Phishing` a confident score.
10. The provider calls the message spam. The engine trusts it least, since the owner's provider misjudges mail both ways.
11. The display name spells out an email at another domain, or sits a short edit distance from a sender or link domain label (today's `ForeignAddress` and `Lookalike`).

Link checks count only for a sender with no earlier mail. The engine turns the checks into one score, for example with a fixed weight per check. A score under `cleanBelow` means `None`, and a score from `spamAt` up means `Junk`. Between those two thresholds the message is ambiguous, and goes to stage 3.

### Stage 3 asks the model about ambiguous mail

For an ambiguous message the engine calls the model once, with the message and the stage 2 reasons. The model judges impersonation: does the message claim an organisation the sender's domain does not belong to. It also gives the message its own spam score. The judgement lives in the model and not in Sieve filters.

Stage 3 runs only when `modelAllowed` is true. A message that stays between the thresholds after stage 3, or never reaches the model, gets `Warn`.

The two services stay apart. One answers where a message belongs, and the other answers whether the message is safe. They can share one model provider.

## What the provider already checks

The owner's mail provider checks URL blocklists, authenticates the message and adds its own spam verdict.

1. Remit runs no URL or IP blocklist lookups. The provider's verdict carries their outcome as one input.
2. Remit does not repeat DKIM, SPF or DMARC. It reads the provider's trusted Authentication-Results.
3. The spam service runs the display-name, link, Reply-To, lookalike and entropy checks. Each fake in "Remit today" passed the provider.

## Placement and labels

1. `Junk` sets the `classifierJunk` input of `classifyPlacement`, next to the category classifier's junk answer. The VIP, well-known and sender-flag rules keep precedence as today.
2. A `Junk` message moves to Junk and gets one Remit label, `Phishing` or `Spam` after `kind`. `ensureClassificationLabels` creates both, next to `Priority` and `Personal`.
3. A `Warn` message stays where it arrived and gets the same label. The mail app warns that Remit suspects the message but cannot confirm it.
4. A new `Message.spamVerdict` holds the response, the score included. It defaults to `NotChecked`, and a message stage 1 let through records `ScreenedOut`.

## Cost per message

Stage 1 reads the sender's row that body sync already reads for placement, and counts the earlier mail the request reports. Remit makes one RDAP query per registrable domain it has not cached yet. Stage 2 makes no network call. Stage 3 makes one model call, which counts against the account's daily cap of 500 (`DEFAULT_CLASSIFICATION_DAILY_LIMIT`), shared with the category classifier. No count exists yet of the mail that reaches stage 3.

## Rescan

Rescan runs the category classifier and the spam service again over up to 10 messages, and answers when they are done. The API operation is `POST /accounts/{accountId}/messages/rescan`, and the MCP tool `rescan_messages` takes the same input.

```ts
type RescanInput = {
  messageIds: UUID[]; // 1 to 10
  move: boolean; // default false
};

type RescanResult = {
  successful: { messageId: UUID; verdict: SpamResponse; labels: string[] }[];
  failed: {
    messageId: UUID;
    code: "RateLimited" | "DailyCap" | "NotFound" | "NotPermitted";
    retryable: boolean;
  }[];
};
```

1. TypeSpec caps `messageIds` at 10 with `@maxItems`. A call with more fails validation with a 400 that names the limit, as SQS `SendMessageBatch` refuses an eleventh entry.
2. By default a rescan writes verdicts, scores and labels only. With `move` it also applies placement.
3. Category stays write-once (RFC 034). A rescan sets it only on mail that is still `uncategorized`.
4. Remit scans the messages in parallel, within the model provider's rate limit and the daily cap. The response follows SQS `SendMessageBatch` and Lambda's `batchItemFailures`: the call succeeds, and each message lands in `successful` or `failed`. `successful` carries the verdict and the labels written.
5. `RateLimited` and `DailyCap` are retryable. `NotFound` and `NotPermitted` are not. The caller retries only the retryable ids.
6. The backfill is a loop in the caller. It pages through `list_threads` or `search_threads`, with the message-date facet where it needs one, and sends ten ids per call.
7. Both hosts serve the operation, because it runs in the request like any other message operation.

## Calibration

`cleanBelow` and `spamAt` come from measured scores. Before placement uses any verdict, one stage builds the evaluation set.

1. The owner rescans the existing mailboxes with `move` off. Every message gets a category classifier answer and a stored spam score.
2. Known spam is the mail the owner reported. Known good is the mail from VIP and well-known senders.
3. `spamAt` sits where the known spam scores begin and the known good scores have thinned out. `cleanBelow` sits below the bulk of the known spam.
4. Code reads both values from configuration. They start as deployment config. `readResolvedClassification` already lets a saved account setting override a deployment value, as it does for `dailyLimit`, and the thresholds follow that path to a per-user setting. Placement reads them from the next stage on.

## Cleanup

Each item below either becomes evidence for the spam service or goes. Unless stated, each path sits in `packages/mailbox-service/src`.

1. `classifyDisplayNameCorrespondence` and `extractOffDomainLinkDomains` in `heuristics/senderMismatch.ts` move into the inline engine as checks 11 and 4. Their DKIM and List-Unsubscribe gates go. The stored `displayNameCorrespondence` and `offDomainLinkDomains` fields, their TypeSpec enum and the call in `classify-message.ts` are deleted. The response reasons hold what they found. Stages 2 and 3.
2. `authenticityVerdict` and its `AuthenticityVerdict` enum are deleted from `typespec/lib/models/Message.tsp`, `packages/data-ports/src/types.ts` and `packages/drizzle-service/src/repos/message.ts`. `Message.spamVerdict` holds the same fact. Stage 7.
3. The demote branch in `heuristics/classifyPlacement.ts` (DKIM mismatch with DMARC fail, and `deferred-to-llm`) is deleted. DMARC failure is check 1. Stage 7.
4. In `heuristics/classifyByHeaders.ts`, the rule that files a DKIM mismatch as `automated` is deleted. The mismatch reaches the service as `signerDomain`. Stage 7.
5. The `personal` fallback in `classifyByHeaders` is deleted. Mail no header rule matches stays `uncategorized` until the category classifier answers. Stage 7.
6. `packages/backend/scripts/backfill-classification.ts` and `classification-backfill.ts` are deleted, replaced by rescan. Stage 5.

## Remit today

Paths below sit under `packages/mailbox-service/src`. These facts hold on main at 22412eb15.

1. In `heuristics/senderMismatch.ts`, `classifyDisplayNameCorrespondence` compares the display name with the sender's domain. It runs only on mail with a DKIM signature, and it skips mail with List-Unsubscribe. Nothing in production reads its result.
2. No code computes `Message.authenticityVerdict`, so every message reads `NotEvaluated`.
3. The category classifier in `classifier/` is opt-in per account. It runs only on new mail after the first folder sync, up to 500 calls a day. A confident `Spam` or `Phishing` answer moves the message to Junk unless the sender is VIP or well known.
4. The classifier applies two Remit labels, `Priority` and `Personal`.
5. `extractProviderSpam` in `heuristics/classifyByHeaders.ts` stores the provider's verdict in `Message.providerSpam`. Placement ignores it (#1553), and the category classifier never sees those headers.
6. No spam service port exists in the code. Research on 2026-11-10 proposed one with rspamd as its default.
7. Header classification runs once, when body sync first stores a body. Older mail stays `NotExamined`, as the bulk of info@ does. The only backfill applies header rules on the VPS and has no Cloudflare path.

Fake Netflix, Belastingdienst and PostNL mail reached the inbox under these rules. Placement read neither the display-name check nor the link check. Nobody knows whether the category classifier ran on that mail, given the limits in item 3.

## Prior art

1. Rspamd and SpamAssassin add up the weights of the rules that match and map the total to one action. Rspamd's actions run from `no action` through `add header` to `reject`. SpamAssassin has one cut-off, `required_score` 5.0, and its Bayes rules wait for 200 marked spam and 200 marked ham messages. ([rspamd metrics](https://docs.rspamd.com/configuration/metrics/), [SpamAssassin conf](https://spamassassin.apache.org/full/4.0.x/doc/Mail_SpamAssassin_Conf.html))
2. Rspamd's `/checkv2` takes the raw message as its body and envelope facts as headers. It answers with `score`, `required_score`, `action` and `symbols`. Feedback goes to `/learnspam`, `/learnham` and `/fuzzyadd`. ([protocol](https://docs.rspamd.com/developers/protocol/)) SpamAssassin's spamd learns through `TELL`. ([PROTOCOL](https://raw.githubusercontent.com/apache/spamassassin/trunk/spamd/PROTOCOL))
3. DMARC (RFC 9989) proves only that an aligned domain matches the From domain. It says nothing about display names or lookalike domains. ([RFC 9989](https://www.rfc-editor.org/rfc/rfc9989.html))
4. Microsoft Defender treats a forged From and an impersonation as two threats, and notes that impersonation can pass SPF, DKIM and DMARC. It drops an impersonation verdict when the recipient already corresponds with the sender. ([anti-phishing](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-about))
5. Gmail keeps suspected spoofing in the inbox with a warning by default. Since 2024-02 bulk senders must pass DMARC and offer one-click unsubscribe. ([advanced phishing](https://knowledge.workspace.google.com/admin/gmail/advanced/advanced-phishing-and-malware-protection), [sender guidelines](https://support.google.com/a/answer/81126))
6. UTS #39 defines the confusable skeleton of a string. Chrome uses it to flag lookalike domains. ([TR39](https://www.unicode.org/reports/tr39/), [Chrome IDN](https://chromium.googlesource.com/chromium/src/+/main/docs/idn.md))
7. SQS `SendMessageBatch` takes up to 10 entries, answers 200 with `Successful` and `Failed` lists, and marks each failure with `SenderFault`. A Lambda SQS consumer returns `batchItemFailures`, and only those messages return to the queue. ([SendMessageBatch](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessageBatch.html), [AWS batch item failure samples](https://github.com/aws-samples/serverless-snippets/tree/main/lambda-function-sqs-report-batch-item-failures))

## Deviations

1. Remit has no rule files and no Bayes core. Bayes scores nothing until the owner has marked hundreds of messages, and nobody staffs rule tuning.
2. Remit runs no milter. It classifies after delivery, over IMAP.
3. The provider's verdict is one input that the engine trusts least. Prior-art research recommends trusting the provider's Junk placement. The owner's ruling overrides it.
4. Remit moves to Junk only mail scoring at `spamAt` or higher. Below that it warns, as Gmail and Microsoft do.
5. Remit queries no DNS blocklist. The provider already checks URLs, and a Worker cannot send raw DNS queries.
6. The engine holds no lists. Microsoft protects a named set of users and domains, and Chrome compares against its top sites. The engine compares the strings inside one message.
7. The engine learns nothing from Report spam. The owner's reports block senders in Remit, outside the engine.
8. The engine ignores ARC seals (RFC 8617). Calibration decides whether forwarded mail needs them.

## Delivery order

Each stage is one PR. Placement uses the verdicts from stage 7 on.

1. The contract, the inline engine with checks 1, 2 and 10, `Message.spamVerdict`, and the stage 1 screens. Body sync records the response and moves nothing. Packages: `typespec`, `data-ports`, `drizzle-service`, `mailbox-service`.
2. The link checks, gated by sender history, and the link half of cleanup item 1. Package: `mailbox-service`.
3. Checks 5, 7 and 11, the registration date in check 8 with its RDAP lookup and cache, and the display-name part of cleanup item 1. Packages: `typespec`, `drizzle-service`, `mailbox-service`.
4. Stage 3: the model call and the shared daily cap. Package: `mailbox-service`.
5. The rescan operation, the `rescan_messages` tool and cleanup item 6. Packages: `typespec`, `backend`, `mailbox-service`, `mcp-server`.
6. Calibration: the rescan of the existing mailboxes, and the two thresholds in config. Package: `mailbox-service`.
7. Placement: the action feeds `classifyPlacement`, with the `Spam` and `Phishing` labels, the warning in the mail app, and cleanup items 2 to 5. Packages: `drizzle-service`, `data-ports`, `web-client`, `mailbox-service`.
8. The rspamd adapter. Package: `mailbox-service`.
9. The spam Worker for the Cloudflare host.

## FAQ

Why not run rspamd as the default? Its rule files need an admin team. Rspamd stays available as an adapter.

Why not let the category classifier decide spam? It answers where mail belongs. Its answer reaches the spam service as one input.

Why not trust the provider's spam verdict? The owner has seen it flag good mail and pass spam. It counts as one input.

Why does the spam service not look up sender history? A database read per message makes it slow and ties it to Remit. Remit passes the counts in the request.

Why is the model last? Each call costs money and a share of the daily cap. Stages 1 and 2 make no model call.

Does a rescan move old mail? Only when the caller sets `move`. By default old mail keeps its folder and gets the label.

Why no brand list? A list needs upkeep and knows only the brands on it. Distance, script and entropy checks work on any name.
