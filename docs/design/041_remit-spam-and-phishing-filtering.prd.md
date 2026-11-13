# Product requirements for spam and phishing in Remit

Companion to RFC 041 (`041_remit-spam-and-phishing-filtering.md`). Status: proposed, 2026-11-13. Requirements only. Nothing here is built.

## Summary

Remit never hides a spam decision from the owner. Every message Remit warns about or moves carries its reasons in plain words. The owner sees the score and the two thresholds behind each decision. The owner can clear a wrong verdict, report a sender, exempt a sender, and tune both thresholds. A settings page counts the mail Remit flagged per day, lists the latest of it, and links to the lists where the owner rescues good mail.

A suspect message stays where it arrived, under a banner that names the suspicion and its cause. Deleting spam moves it to Trash. Remit deletes nothing on its own, and nothing runs on a schedule.

## Rulings this document keeps

The RFC sets these, and every story below holds to them.

1. The spam service judges only what Remit sends it. It never reads Remit's database.
2. The judge holds no curated list of brands, providers or domains.
3. `Warn` leaves the message in place and labels it `Spam` or `Phishing`. The mail app shows the warning.
4. Report spam sets the sender's `blocked` flag. Remit's screening stage sends that sender's mail to Junk without a call to the judge. Detected spam never sets the flag.
5. Delete means Trash.
6. No scheduled background job exists. Counts are read when a page asks for them, and a re-check runs only while the owner waits for it.

## Prior art

1. Gmail puts a banner on each message in Spam that names one reason, such as "Spoofed email addresses" or "Messages from an unconfirmed sender". Not spam moves the message out, and "Delete all spam messages now" deletes for good. ([Gmail help](https://support.google.com/mail/answer/1366858)) Remit adopts the banner with a plain reason. Remit lists every reason in the intelligence rail, since one reason hides the rest. Remit skips the permanent delete.
2. Fastmail has four protection levels: Off, Standard, Aggressive and Custom. Custom sets the score thresholds for the Spam folder and for deleting to Trash. ([Fastmail help](https://www.fastmail.help/hc/en-us/articles/1500000278142)) Remit adopts numeric thresholds the owner can set. Remit skips presets and the delete threshold.
3. Proton keeps Spam, Block and Allow lists of addresses or domains. Block drops mail before delivery. A banner warns when a sender fails domain authentication. ([lists](https://proton.me/support/spam-filtering), [banner](https://proton.me/support/email-has-failed-its-domains-authentication-requirements-warning)) Remit adopts per-address allow and block, which exist today as `neverSpam` and `blocked`. Remit skips dropping mail, because it reads mail after delivery.
4. HEY's Screener holds each first-time sender until the owner screens them in or out. Screener History reverses a decision and shows that sender's mail from the last 90 days. ([Screener](https://www.hey.com/features/the-screener/)) Remit adopts sender decisions the owner can reverse, listed in Settings, Senders. Remit skips holding first-contact mail. First contact is one piece of evidence for the judge (check 8).

## Functional requirements

The user is the owner of the mailbox. The test plan appendix maps each criterion to one test.

### S1, read why

As the owner reading a flagged message, I want to see why Remit flagged it, so that I can judge the message myself.

1. On a message with a `Checked` verdict of `Warn` or `Junk`, opening the intelligence rail lists every reason as one plain sentence, with what the check found, such as the domain behind a link.
2. The same rail shows the score beside both thresholds: "Score 0.72. Remit warns from 0.40 and moves to Junk from 0.85."
3. When the model judged the message, the rail says so and quotes the model's reason.
4. When stage 1 let a message through, its rail names the rule: VIP, well known, Never in Spam, a named filter, or a newsletter from a known sender.
5. When a reported sender's message went straight to Junk, its rail reads "You reported this sender" above a Not spam button.

### S2, see the warning

As the owner of a suspect message, I want it to stay where it arrived and say what Remit suspects, so that I decide without searching Junk.

1. Opening a warned message of kind `Spam` shows a banner above the body: "Remit suspects this is spam". The banner names the top reason and holds three buttons: Not spam, Report spam and Why.
2. A warned `Phishing` message carries the banner "Remit suspects this message impersonates someone", in the danger tone, with the same three buttons.
3. In any message list, a warned row carries the `Spam` or `Phishing` chip plus a "Suspected" marker. A row Remit moved to Junk carries the chip alone.
4. Pressing Why opens the intelligence rail on that message, scrolled to the verdict.

### S3, clear a wrong verdict

As the owner facing a false alarm, I want to mark one message as not spam, so that the warning goes and the message leaves Junk.

1. Not spam on a warned message removes its label and its banner. The message keeps its folder.
2. Not spam on a message Remit moved to Junk returns it to the Inbox without its label, then shows the "Never put this sender in Spam" offer (#612).
3. A re-check of a cleared message adds no `Spam` or `Phishing` label.

### S4, report a sender

As the owner receiving unwanted mail, I want to report a message as spam, so that the sender's later mail lands in Junk.

1. Report spam moves the message to Junk with the `Spam` label, and lists its sender under Blocked in Settings, Senders (#648).
2. A reported sender's next message lands in Junk with the reason "You reported this sender".

### S5, exempt someone

As the owner managing senders, I want to exempt a sender from spam checks, so that their mail always reaches me.

1. Mail from a sender marked Never in Spam arrives with no label and no banner. Its rail states that the check was skipped for that reason.

### S6, set the thresholds

As the owner tuning the filter, I want to set the scores at which Remit warns and moves, so that I choose between missed spam and false alarms.

1. In Settings, Spam, the owner saves "Warn from" and "Move to Junk from". A reload shows the saved values.
2. Reset returns both values to the deployment default, and the page names that default.
3. Before a save, the page counts the messages from the last 30 days that the new values warn about and move.
4. Beside the saved values, the page states that they apply to mail arriving from now on, and that Check again updates older mail.

### S7, pick an action per label

As the owner deciding what leaves my inbox, I want to choose for `Spam` and for `Phishing` whether a high score moves the message or only warns, so that each label behaves as I choose.

1. With `Spam` set to "Warn only", a `Spam` message scoring at or above "Move to Junk from" keeps its folder under the warning banner. The rail notes that the score reached the Junk threshold.
2. With `Phishing` set to "Move to Junk", a `Phishing` message at or above that threshold moves to Junk.

### S8, see the counts

As the owner checking the filter, I want daily counts of what Remit flagged, so that I can tell whether the filter works.

1. Settings, Spam shows one count per day for the last 30 days, split into moved and warned, and into `Spam` and `Phishing`.
2. Next to those counts, the page shows the number of messages the owner marked Not spam over the same days.
3. For an account with no checked mail, the page reads "Remit has not checked any mail yet" in place of a chart of zeros.

### S9, review and rescue

As the owner looking for lost mail, I want to review the latest flagged messages and rescue the good ones, so that nothing good stays hidden.

1. Settings, Spam lists the 10 latest warned or moved messages, with sender, subject, date, label, action and top reason.
2. Review all opens the `Spam` label list, and a second link opens the `Phishing` label list.
3. Selecting messages in a label list and pressing Not spam treats each one as S3.1 or S3.2 does.
4. Deleting messages from a label list or from Junk moves them to Trash.
5. Remit leaves flagged mail of any age in place until the owner moves or deletes it.

### S10, check again

As the owner after a threshold change, I want to re-check the messages I pick, so that old verdicts catch up.

1. Check again on any number of picked messages sends ten per call, shows progress such as "Checked 20 of 35", and shows each new verdict.
2. A re-check that turns a message into `Junk` leaves it in its folder, and its banner holds a Move to Junk button.

## Non-functional requirements

### N1, errors

1. A message whose verdict is `Failed` shows the banner "Remit couldn't check this message", the failure, and a Check again button.
2. A reason name the app has no sentence for shows in the rail as "Remit ran a check this version can't describe", with the name and a report-an-issue link.
3. A `Warn` the model never judged, because the account has no model or reached its daily cap, says which in its banner, and says only the basic checks ran.
4. After `RateLimited` or `DailyCap` failures, Check again lists those messages with "Try again in a minute" or "Try again tomorrow". Its retry sends only those ids.
5. After `NotFound` or `NotPermitted` failures, the page names each message and its cause, holds no retry, and links to report an issue.
6. Saving thresholds where "Warn from" is not below "Move to Junk from", or a value outside 0 to 1, saves nothing and names the broken rule.
7. A failed Report spam or Not spam shows a banner naming the action, with Try again, as "Couldn't report this message as spam" does today.
8. A 401 or 403 on the counts, the latest list or Check again shows the signed-out notice. It never shows an empty list or a zero.

### N2, keyboard and accessibility

1. Tab moves focus through the three banner buttons in reading order, each with a visible focus ring.
2. A screen reader reads the banner text before the body. An icon and the text carry the tone, besides colour.
3. The threshold form can be filled in, saved and reset with the keyboard alone.

### N3, URL and phone

1. Settings, Spam lives at the path `/settings/spam`, and a reload opens the same page.
2. A rail opened by Why comes back on reload from the message itself, never from the fragment (url-state R6).
3. At phone width, the banner and its three buttons fit without horizontal scroll.

## RFC gaps

The requirements need these, and the RFC does not give them.

1. The message response and thread rows carry no `spamVerdict`. S1, S2.3 and N1.1 need action, kind, score, reasons and `modelCalled` on the message, and action and kind on the row.
2. Reason names are free strings. A TypeSpec enum, as #1579 sets for placement reasons, lets the app hold a sentence for each one.
3. Stage 3 returns a score with no named reason. S1.3 needs the model's reason as text, and N1.3 needs a reason naming a skipped model call and its cause.
4. `ScreenedOut` records no rule. S1.4 and S5.1 need the stage 1 rule, with the filter's id.
5. No mark stops a re-check from labelling a message the owner cleared (S3.3).
6. No setting holds "Warn only" per kind (S7). It follows the threshold path through `readResolvedClassification`.
7. The RFC names no setting fields or validation for the per-user thresholds (S6.1, N1.6).
8. `getClassificationStats` (#1620) counts categories since a date. S8 needs spam verdicts per day, by action and kind, plus Not spam counts, as an optional field on that operation.
9. No operation returns recent scores by band, which the count in S6.3 needs.
10. Search takes one `labelId`, and the latest list in S9.1 spans `Spam` and `Phishing`.

## Open questions

1. No UX spec or wireframes exist yet. The story names in the appendix are proposals for the `ux-designer` agent to confirm.
2. #605 moves a Never in Spam sender's mail out of Junk. Whether the grant also clears `Warn` labels on that sender's older mail is undecided.
3. Whether a `Phishing` warning disables the links in the body is undecided.
4. Proton blocks and allows whole domains. Remit's flags apply to one sender.

## FAQ

Why show the score at all? The owner asked for no black box. The score and thresholds show how close the call was.

Why no presets like Fastmail? Calibration sets the defaults from the owner's own mail. Nobody measured the numbers behind a preset.

Why does Report spam not train the judge? The RFC rules out a learn loop. A report blocks the sender in Remit instead.

Why does Check again run in the page? The RFC rules out scheduled jobs. The page sends ten ids per call while the owner waits.

## Test plan appendix

Each criterion maps to one test. Unit tests feed their own inputs. Playwright tests run with no mocks against the inline engine. Stories follow `docs/architecture/storybook.md` in reader-ui, and a proposed story carries the `proposed` tag.

| Criterion | Level | Test or story |
| --- | --- | --- |
| S1.1 | Story | `Design System/Spam/SpamVerdictPanel` `WarnSpam`, `JunkPhishing` |
| S1.2 | Unit | score and threshold sentence, ui |
| S1.3 | Story | `Design System/Spam/SpamVerdictPanel` `ModelJudged` |
| S1.4 | Unit | stage 1 screen returns the named rule, mailbox-service |
| S1.5 | Story | `Design System/Spam/SpamVerdictPanel` `ReportedSender` |
| S2.1 | Story | `Design System/Spam/SpamWarningBanner` `WarnSpam` |
| S2.2 | Story | `Design System/Spam/SpamWarningBanner` `WarnPhishing` |
| S2.3 | Story | `Design System/Spam/SpamRowMarker` `Warned`, `Moved` |
| S2.4 | Playwright | `spam-warning.spec.ts`: Why opens the rail |
| S3.1 | Playwright | `spam-warning.spec.ts`: Not spam on a warned message |
| S3.2 | Playwright | `spam-rescue.spec.ts`: Not spam from Junk |
| S3.3 | Unit | re-check skips a cleared message, mailbox-service |
| S4.1 | Playwright | `report-spam.spec.ts` |
| S4.2 | Unit | blocked sender to Junk with no judge call, mailbox-service |
| S5.1 | Unit | Never in Spam screens out, mailbox-service |
| S6.1 | Playwright | `spam-settings.spec.ts`: save and reload |
| S6.2 | Playwright | `spam-settings.spec.ts`: reset |
| S6.3 | Story | `Playground/Proposed/Spam settings` `Preview` |
| S6.4 | Story | `Playground/Proposed/Spam settings` `Default` |
| S7.1 | Unit | Warn only keeps a high-scoring `Spam` in place, mailbox-service |
| S7.2 | Unit | Move to Junk moves a high-scoring `Phishing`, mailbox-service |
| S8.1 | Unit | per-day counts by action and kind, in the account's time zone |
| S8.2 | Unit | Not spam count over the same days |
| S8.3 | Story | `Playground/Proposed/Spam settings` `NothingChecked` |
| S9.1 | Story | `Playground/Proposed/Spam settings` `Default` |
| S9.2 | Playwright | `spam-settings.spec.ts`: Review all |
| S9.3 | Playwright | `spam-rescue.spec.ts`: bulk Not spam |
| S9.4 | Playwright | `spam-rescue.spec.ts`: delete moves to Trash |
| S9.5 | None | finding 1 |
| S10.1 | Unit | batches of ten and the progress count, web-client |
| S10.2 | Story | `Design System/Spam/SpamWarningBanner` `NowJunk` |
| N1.1 | Story | `Design System/Spam/SpamWarningBanner` `CheckFailed` |
| N1.2 | Story | `Design System/Spam/SpamVerdictPanel` `UnknownReason` |
| N1.3 | Story | `Design System/Spam/SpamWarningBanner` `ModelSkipped` |
| N1.4 | Unit | retry picks only retryable ids, web-client |
| N1.5 | Story | `Playground/Proposed/Spam check again` `PartialFailure` |
| N1.6 | Unit | threshold validation |
| N1.7 | Story | `Playground/Shipped/Mail/ErrorBanner` `ReportSpamFailed` |
| N1.8 | Story | `Playground/Proposed/Spam settings` `SignedOut` |
| N2.1 | Playwright | `spam-warning.spec.ts`: Tab order |
| N2.2 | Story | `Design System/Spam/SpamWarningBanner` `ReadingOrder` |
| N2.3 | Playwright | `spam-settings.spec.ts`: keyboard only |
| N3.1 | Playwright | `spam-settings.spec.ts`: path and reload |
| N3.2 | Playwright | `spam-warning.spec.ts`: reload after Why |
| N3.3 | Story | `Design System/Spam/SpamWarningBanner` `Phone` |

Findings:

1. S9.5 states an absence, and no test proves an absence. Review holds it, with ruling 6.
2. S3.3, S6.3, S7 and S8 test behaviour that RFC gaps 5, 6, 8 and 9 must supply first.
