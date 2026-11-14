# Remit spam and phishing filtering

RFC 041. Status: built, 2026-11-14, in reader #1648 to #1653 and reader-ui #44 and #45. Calibration has not run yet, so the thresholds are unset.

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
    receivedAt: string; // ISO 8601 with offset, when the server received the message
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

The judge compares `senderDomainRegisteredAt` with `receivedAt`, so it never reads the clock. Remit fetches `senderDomainRegisteredAt` over RDAP while it gathers the evidence, in `mailbox-service`. It caches the answer in one row per registrable domain, because the date never changes. A registry that publishes no date leaves the field absent, and Remit never fills in a placeholder. DENIC's RDAP answer for a .de domain carries no registration event, so a missing date weighs lightly in the judge's score.

### Response

```ts
type SpamResponse =
  | {
      state: "Checked";
      score: number; // 0 to 1
      action: "None" | "Warn" | "Junk";
      kind: "Spam" | "Phishing";
      reasons: SpamReason[];
      modelOutcome: "Answered" | "NotConfigured" | "DailyLimit" | "RateLimited" | "OutOfBand";
    }
  | { state: "Failed"; kind: SpamFailureKind };

type SpamReasonName =
  | "DmarcFail" // check 1
  | "SignerMismatch" // check 1
  | "ReplyToMismatch" // check 2
  | "LinkTextMismatch" // check 3
  | "LinkDomainDistant" // check 4
  | "PunycodeDomain" // check 5
  | "MixedScriptDomain" // check 5
  | "ConfusableDomains" // check 5
  | "SingleOffDomainLink" // check 6
  | "GeneratedName" // check 7
  | "FirstContactDomain" // check 8
  | "RecentlyRegisteredDomain" // check 8
  | "UnknownRegistrationDate" // check 8
  | "ClassifierSpam" // check 9
  | "ClassifierPhishing" // check 9
  | "ProviderSpam" // check 10
  | "DisplayNameForeignAddress" // check 11
  | "DisplayNameLookalike" // check 11
  | "ModelImpersonation" // stage 3
  | "ModelSpam" // stage 3
  | "ModelClean" // stage 3
  | "ListedPhishingLink" // a backend only
  | "BackendSymbol";

type SpamReason = {
  name: SpamReasonName;
  symbol: string; // the backend's own name for the check
  score: number;
  options: string[];
};
```

The service compares the score with two thresholds to pick the action. While the thresholds are unset, every action is `None`. `kind` is `Phishing` when the message impersonates someone, and `Spam` otherwise. A reason has the shape of an rspamd symbol: the check's name, what it added to the score, and what it found, such as the domain behind a link. The names form a closed enum, so the mail app maps each one to one plain sentence. `symbol` holds the backend's own name for the check, and the inline engine sets it to `name`. A backend symbol with no matching name arrives as `BackendSymbol`, and the mail app shows it as an unknown reason. Only a backend such as rspamd reports `ListedPhishingLink`, for a link a phishing feed lists. `modelOutcome` names why the model did not answer, when it did not.

### Backends

1. The inline engine runs inside Remit. Remit builds it as the default backend.
2. The rspamd adapter posts `message.raw` to `/checkv2`. It sends `envelope` as the `From`, `Rcpt`, `IP` and `Helo` headers. It drops `context`, which rspamd has no field for. The adapter divides `score` by `required_score` to get the 0 to 1 score, and maps symbols and actions as the next section lists.

The backend is deployment config: `SPAM_BACKEND` is `Inline` (the default) or `Rspamd`, with `SPAM_RSPAMD_URL`. Both hosts read the same variables, the VPS from its environment and the Cloudflare host from its Worker vars. A spam Worker backend is not built, so the Cloudflare host runs the inline engine.

### Rspamd mapping

1. A symbol that means the same as a Remit reason takes that name:

| Rspamd symbol | Remit reason |
| --- | --- |
| `DMARC_POLICY_*` | `DmarcFail` |
| `REPLYTO_DOM_NEQ_FROM_DOM` | `ReplyToMismatch` |
| `PHISHING` | `LinkTextMismatch` |
| `OMOGRAPH_URL`, `MIXED_CHARSET_URL` | `MixedScriptDomain` |
| `SPOOF_DISPLAY_NAME`, `FROM_NEQ_DISPLAY_NAME` | `DisplayNameForeignAddress` |
| `PHISHED_*` | `ListedPhishingLink` |

2. Every other symbol becomes `BackendSymbol`, with its rspamd name in `symbol`.
3. `reject`, `discard` and `quarantine` map to `Junk`.
4. `add header`, `greylist`, `rewrite subject` and `soft reject` map to `Warn`.
5. `no action` maps to `None`.
6. Rspamd keeps its own action, so a deployment that names rspamd refuses the two threshold variables.

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

1. DMARC fails, or the DKIM signer is another domain (`SignerMismatch`).
2. The Reply-To domain differs from the From domain.
3. A link's visible text shows a domain that differs from its href.
4. A link points to a domain far from the sender's, by edit distance.
5. A domain label is punycode or mixes scripts, or two domains in the message share a UTS #39 skeleton without being equal.
6. Rich HTML carries a single link or button, and it points to a domain other than the sender's.
7. A domain or the address's local part has high character entropy, as a generated name does.
8. The sender's domain has sent this account nothing before, or was registered recently.
9. The category classifier gave `Spam` or `Phishing` a confident score.
10. The provider calls the message spam. The engine trusts it least, since the provider misjudges mail both ways.
11. The display name spells out an email at another domain, or sits a short edit distance from a sender or link domain label (today's `ForeignAddress` and `Lookalike`).

Link checks count only for a new sender. The engine turns the checks into one score, for example with a fixed weight per check. A score under `cleanBelow` means `None`, and a score from `spamAt` up means `Junk`. Between those two thresholds the message is ambiguous, and goes to stage 3.

### Stage 3 asks the model about ambiguous mail

Stage 3 runs in Remit after the spam service answers `Warn`. Remit calls the account's model once, with the message and the stage 2 reasons. The model judges impersonation: does the message claim an organisation the sender's domain does not belong to. Its score replaces the stage 2 score and sets the action again, and its verdict adds `ModelImpersonation`, `ModelSpam` or `ModelClean` with the model's reason quoted. An impersonation makes the kind `Phishing`.

Stage 3 runs only when `modelAllowed` is true. A message that stays between the thresholds after stage 3, or never reaches the model, gets `Warn`. A rate-limited call skips the model and records `RateLimited`, and any other model failure makes the verdict `Failed`.

The two services stay apart. One answers where a message belongs, and the other answers whether the message is safe. They can share one model provider.

## What the provider already checks

The owner's mail provider checks URL blocklists, authenticates the message and adds its own spam verdict.

1. Remit runs no URL or IP blocklist lookups. The provider's verdict carries their outcome as one input.
2. Remit does not repeat DKIM, SPF or DMARC. It reads the provider's trusted Authentication-Results.
3. The spam service runs the display-name, link, Reply-To, lookalike and entropy checks. Fake Netflix, Belastingdienst and PostNL mail passed the provider before this work.

## Placement and labels

1. `Junk` sets the `junk` input of `classifyPlacement`, next to the category classifier's junk answer. The VIP, well-known and sender-flag rules keep precedence.
2. A `Junk` message moves to Junk and gets one Remit label, `Phishing` or `Spam` after `kind`. The owner can set each kind to `WarnOnly` in Settings, Spam (`spamPlacementSpam`, `spamPlacementPhishing`), and then a `Junk` verdict of that kind stays in place.
3. A `Warn` message stays where it arrived and gets the same label. The mail app warns that Remit suspects the message but cannot confirm it.
4. `Message.spamVerdict` holds the response, the score included. It defaults to `NotChecked`. A message stage 1 let through records `ScreenedOut` with the rule that let it through.
5. Not spam removes the `Spam` and `Phishing` labels and sets `Message.spamCleared`. A later Report spam clears it. A rescan records a cleared message's verdict without a label or a move.
6. Not spam on a message in Junk that the owner never reported also sets the sender's `neverSpam` flag.
7. The mail app draws its spam marks from those two labels, and draws none while `spamCleared` is true. It makes no Never in Spam offer, because Not spam already sets the flag.

## Cost per message

Stage 1 reads the sender's row that body sync already reads for placement, and counts the earlier mail the request reports. Remit makes one RDAP query per registrable domain it has not cached yet. Stage 2 makes no network call. Stage 3 makes one model call, which claims one unit of the account's daily cap of 500 (`DEFAULT_CLASSIFICATION_DAILY_LIMIT`), shared with the category classifier. No count exists yet of the mail that reaches stage 3.

## Rescan

Rescan runs the category classifier and the spam service again over up to 10 messages, and answers when they are done. The API operation is `POST /accounts/{accountId}/messages/rescan`, and the MCP tool `rescan_messages` takes the same input.

```ts
type RescanInput = {
  messageIds: UUID[]; // 1 to 10
  move: boolean; // default false
};

type RescanResult = {
  successful: { messageId: UUID; verdict: MessageSpamVerdict; labels: string[] }[];
  failed: {
    messageId: UUID;
    code: "RateLimited" | "DailyCap" | "NotSettled" | "NotFound" | "NotPermitted";
    retryable: boolean;
  }[];
};
```

1. TypeSpec caps `messageIds` at 10 with `@maxItems`. A call with more fails validation with a 400 that names the limit, as SQS `SendMessageBatch` refuses an eleventh entry.
2. By default a rescan writes verdicts, scores and labels only. With `move` it also applies placement.
3. Category stays write-once (RFC 034). A rescan sets it only on mail that is still `uncategorized`.
4. Remit scans the messages in parallel, within the model provider's rate limit and the daily cap. The response follows SQS `SendMessageBatch` and Lambda's `batchItemFailures`: the call succeeds, and each message lands in `successful` or `failed`. `successful` carries the verdict and the labels written.
5. `RateLimited`, `DailyCap` and `NotSettled` are retryable. `NotSettled` means a move of the message is still settling, so `move` cannot place it yet. `NotFound` and `NotPermitted` are not retryable. The caller retries only the retryable ids.
6. The backfill is a loop in the caller. It pages through `list_threads` or `search_threads`, with the message-date facet where it needs one, and sends ten ids per call.
7. Both hosts serve the operation, because it runs in the request like any other message operation.

## Calibration

`cleanBelow` and `spamAt` come from measured scores. Before placement uses any verdict, one stage builds the evaluation set.

1. The owner rescans the existing mailboxes with `move` off. Every message gets a category classifier answer and a stored spam score.
2. Known spam is the mail the owner reported. Known good is the mail from VIP and well-known senders.
3. `spamAt` sits where the known spam scores begin and the known good scores have thinned out. `cleanBelow` sits below the bulk of the known spam.
4. The values go in `SPAM_CLEAN_BELOW` and `SPAM_AT` on both hosts. Both or neither must be set, each from 0 to 1, and a host refuses to start on a broken pair. `getUserSettings` returns them read-only in `spam.thresholds`, the place a per-user setting can later fill.
5. `getClassificationStats` returns `spamScoreBands`, counts per score band of width 0.05, so the owner can read where the bands fall.

## Cleanup

Each item below either became evidence for the spam service or went. Items 1, 2, 4, 5 and 6 shipped. Unless stated, each path sits in `packages/mailbox-service/src`.

1. `classifyDisplayNameCorrespondence` and `extractOffDomainLinkDomains` in `heuristics/senderMismatch.ts` move into the inline engine as checks 11 and 4. Their DKIM and List-Unsubscribe gates go. The stored `displayNameCorrespondence` and `offDomainLinkDomains` fields, their TypeSpec enum and the call in `classify-message.ts` are deleted. The response reasons hold what they found.
2. `authenticityVerdict` and its `AuthenticityVerdict` enum are deleted from `typespec/lib/models/Message.tsp`, `packages/data-ports/src/types.ts` and `packages/drizzle-service/src/repos/message.ts`. `Message.spamVerdict` holds the same fact.
3. In `heuristics/classifyPlacement.ts` the `deferred-to-llm` branch is gone. The demote for DKIM mismatch with DMARC fail stays until the thresholds are set, and goes after that. DMARC failure is check 1.
4. In `heuristics/classifyByHeaders.ts`, the rule that files a DKIM mismatch as `automated` is deleted. The mismatch reaches the service as `signerDomain`.
5. The `personal` fallback in `classifyByHeaders` is deleted. Mail no header rule matches stays `uncategorized` until the category classifier answers.
6. `packages/backend/scripts/backfill-classification.ts` and `classification-backfill.ts` are deleted, replaced by rescan.

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

1. #1648: the contract, the inline judge, evidence gathering with RDAP, `Message.spamVerdict` and the stage 1 screens.
2. #1649: the rspamd backend.
3. #1650: stage 3 and the rescan operation.
4. #1651: placement and the two spam labels.
5. #1652: one classify-and-record step shared by body sync and rescan.
6. #1653: `spamCleared` on Not spam.
7. The two reader-ui PRs: the banner, the row mark, the rail section, Check again and Settings, Spam.
8. Not built yet: calibration, then the deletion of the DKIM demote, then a spam Worker backend.

## FAQ

Why not run rspamd as the default? Its rule files need an admin team. Rspamd stays available as an adapter.

Why not let the category classifier decide spam? It answers where mail belongs. Its answer reaches the spam service as one input.

Why not trust the provider's spam verdict? The owner has seen it flag good mail and pass spam. It counts as one input.

Why does the spam service not look up sender history? A database read per message makes it slow and ties it to Remit. Remit passes the counts in the request.

Why is the model last? Each call costs money and a share of the daily cap. Stages 1 and 2 make no model call.

Does a rescan move old mail? Only when the caller sets `move`. By default old mail keeps its folder and gets the label.

Why no brand list? A list needs upkeep and knows only the brands on it. Distance, script and entropy checks work on any name.
