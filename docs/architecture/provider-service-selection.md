# Which services an account syncs, and where a provider calendar lives

Status: proposed
Scope: `Account`, `CalendarCollection`, `CalendarSource`, the account endpoints, and the mail and calendar sync workers. Settles the two model questions epic #1174 blocks on. Stages #1180 and #1185 file the shapes at the end for approval.

## Context

An Outlook or Gmail account must sync calendar only, mail only, or both (#1174). Two model facts block every implementation stage.

`Account` says nothing about which services it syncs. `isActive: false` is the deletion tombstone fence three workers read (`packages/account-worker/src/handlers/account-fanout.ts:114`, `.../account-finalize.ts:46`, `packages/imap-worker/src/events.ts:197`), so it cannot carry "mail off, calendar on".

`CalendarCollection` carries no `accountId`, so nothing tells one account's provider calendar from another's on the same config.

The research answers filed on #1175 (Microsoft Graph) and #1176 (Google) are the grounds cited below. The epic's invariants 1 to 7 bind every decision here.

## Decisions

### D1 - an account carries a set of the services it syncs

`Account` carries `syncedServices: AccountService[]`, defaulting to `#[AccountService.Mail]`.

Two booleans spread the "one service or more" rule across two fields, so no single write validates on its own, and storage can hold the empty choice that D6 refuses. A third service then costs a third field and a third clause at every call site, where a set costs one enum member. `Mailbox.specialUse` is the precedent for an enum set on a row. `POST /accounts/oauth/microsoft/start` maps the set straight onto a scope list, which is what invariant 3 asks of onboarding (#1175 section 2).

### D2 - the set holds `Mail` and `Calendar`, and an IMAP account holds `Mail`

Microsoft and Google both separate mail from calendar at the scope level. Microsoft puts `Mail.ReadWrite`, `Mail.Send` and `Calendars.Read` on one Graph resource and makes each consentable on its own (#1175). Google's mail scope sits in the restricted verification tier and its calendar scope in the sensitive tier, so an operator can ship one without the other (#1176). Contacts and CardDAV are out of scope for the epic (#14).

A `Password` account holds `#[Mail]`, and the account endpoints refuse any other value for it (invariant 4). An IMAP account written before #1180 has no stored attribute at all, and the epic says no migration touches it, so the default has to reach the workers as well as the API. The repository read path coalesces it: `rowToAccount` in `packages/drizzle-service/src/repos/i4-account.ts` maps a stored row to an `AccountItem`, and `packages/imap-worker` reads accounts through that same `IAccountRepository` (`packages/imap-worker/src/scheduler/handler.ts:37`). An absent `syncedServices` becomes `#[Mail]` there, so backend and worker read one value. The API response layer already coalesces `smtpHost` and `smtpPort` the same way (`packages/backend/src/handlers/account-guards.ts:114`), and it keeps doing that for a row the port never touched.

### D3 - a provider calendar is an account-owned `CalendarCollection`

`CalendarCollection` takes an `accountId`. `CalendarSource` takes a fourth member, `ProviderSynced`. Those two attributes are the whole change to the entity.

The `.ics` feed, `/calendars`, `/calendar-events`, free-busy and the CalDAV path all read `CalendarCollection` today. A separate provider-calendar entity doubles every one of those read paths. The primary index stays `pk accountConfigId, sk calendarId`, so a person's calendar list is one query and no DAV path changes. Both new values reach clients through `CalendarResponse`, which settings needs to show which account owns which calendar (#1179).

A collection no account owns carries twenty-five zeros. `UUID` is pinned to exactly 25 characters (`typespec/lib/scalars/string.tsp`), so an RFC 4122 literal fails the scalar and breaks every stored calendar on read.

No index answers "which calendars does this account own". The account config's collections come back on the primary index and the caller filters them on `accountId`. An account holds a handful of calendars, which `CalendarListResponse` already relies on when it refuses to paginate (`typespec/lib/models/CalendarApi.tsp`). A GSI keyed on `accountId` also puts every person-owned collection in one sentinel partition.

A provider collection derives its `urlSegment` from a digest of the account id and the provider's own calendar id, lower-case hex, truncated to fit `String64`. `urlSegment` is a case-folded `String64` that a client bookmarks as a path segment (`typespec/lib/models/CalendarCollection.tsp:51`), and a digest meets that bound and that alphabet whatever shape the provider's id has. The digest also runs deterministically, so a sync round re-provisions the same row and two Outlook accounts under one config never collide.

Reader answers 400 to its own write into a `ProviderSynced` collection, the refusal `deleteCalendar` already gives for the default collection (`typespec/main.tsp:387`). Sync runs one way (invariant 7), so an event written here loses to the next round.

### D4 - switching calendar sync off deletes nothing and writes nothing

The collection, its `CalendarObject` rows, its `syncSequence` and its feed token all stay. `/calendars` still lists it, `/calendar-events` still returns its events, and `/feeds/calendar` serves the iCalendar text it served before. The content freezes at the last completed sync round.

Invariant 1 states that disable is not delete. Each calendar mints and revokes its own feed token (`typespec/main.tsp:409`, `typespec/main.tsp:425`), so a subscriber starts getting 404 once someone revokes that token. A service toggle is a different act.

### D5 - the mail surfaces read stored rows, and the From picker filters

The mail list, the brief, search and folder appointments read stored rows and never look at `syncedServices`. A calendar-only account owns no mailboxes and no messages, so it reaches none of those surfaces and none of them needs to know why (invariant 5). An account that stops syncing mail keeps the rows it holds, and those rows stop changing (invariant 1).

The compose From picker is the exception, because it reads the configured account list instead of stored rows (`packages/web-client/src/components/compose/FromSelector.tsx:19`). Unfiltered it lists a calendar-only account as a sender, which invariant 5 forbids and the send path refuses. So the picker lists only accounts holding `Mail`. When that leaves nothing to send from, compose raises the banner it already raises for a missing SMTP configuration (`ComposeSmtpMissingBanner`), pointed at the account's service toggle instead of its SMTP settings (#1182). That banner's copy is a module constant naming SMTP (`SMTP_MISSING_MESSAGE`, `packages/ui/src/components/compose-smtp-missing-banner.tsx:9`), so reusing it turns the message into a prop, and #1182 files that change. A person who switched mail off gets told where to switch it back on, and every account the picker lists can send.

Two other paths read the service set. The mail sync worker skips an account without `Mail` (#1181). The send path refuses one, and it checks the set ahead of `smtpEnabled` so the error names the toggle instead of the SMTP configuration. `smtpEnabled` keeps its RFC 032 meaning of "this account has working SMTP configuration" and answers second.

Settings keeps listing every account, because that is where the toggle lives (#1179).

### D6 - the API boundary refuses an empty set

`POST /accounts`, `PATCH /accounts/{accountId}` and the OAuth start endpoint answer 400 on an empty `syncedServices`. No stored row ever holds it, so no worker handles it.

`PATCH` also answers 400 when the new set names a service the account's OAuth grant never covered, and the error names `POST /accounts/oauth/microsoft/start` as the route. Adding a service is a consent round trip (invariant 6): the scopes come from the authorization request, so a PATCH alone cannot grant them, and it leaves a row claiming a service the token cannot reach.

`isActive: false` cannot mean "syncs nothing". That flag is the tombstone fence and pairs with `deletedAt`, so reusing it makes a live account read the same as one the cascade is deleting. `DELETE /accounts/{accountId}` is the route to syncing nothing, and it already exists. #1179 points there when the person switches the last service off.

### D7 - re-enabling resumes from the stored cursor and falls back to a full sync

A toggle never clears a cursor. The first round after re-enabling sends the stored cursor, and starts a full sync when the provider rejects it. Both providers already force that branch: Google answers an expired `syncToken` with `410`, and Microsoft answers an expired one either with `410` and an empty `$deltatoken` or with a 40X `syncStateNotFound` for Outlook entities (#1176 section 7, #1175 section 4). #1186 handles both, so re-enabling needs no code path scheduled sync lacks.

The cursor does not live on `CalendarCollection`. `CalendarResponse` spreads the whole entity (`typespec/lib/models/CalendarApi.tsp:47`), so the entity hands every attribute it holds to every client, and a delta token has no consumer in a calendar list. Sync state lives in its own worker-side entity, keyed by the account and the calendar it mirrors at the provider, outside that spread. #1185 states its exact shape before implementation.

Two constraints ride on that state. A sync window, where the provider has one, stays fixed across a toggle: Microsoft bakes the window into the delta token, so widening it forces a full resync (#1175 section 4). And a full resync must diff the collection against the returned set and drop what the provider dropped, because a resync carries no per-item deletion entries.

A mail resume needs one more step. Graph can miss a change notification when a message moves out of a folder and back in (#1175 section 8), so #1181 runs a reconciliation pass and re-enabling schedules it before the first delta round.

## The TypeSpec changes these stages file for approval

Both sets are additive: new optional request fields, new response fields, one new enum and one new enum member. The epic pre-approves the surface; each stage still files the exact shape below.

### Stage #1180 - an account declares the services it syncs

New file `typespec/lib/enums/AccountService.tsp`:

```typespec
namespace RemitImap;

@doc("A service an account syncs. `Mail` covers messages, folders and sending; `Calendar` covers a provider calendar read into the calendar store.")
enum AccountService {
  Mail: "Mail",
  Calendar: "Calendar",
}
```

`typespec/lib/enums/index.tsp`:

```diff
 import "./AccountAuthType.tsp";
 import "./AccountConfigState.tsp";
+import "./AccountService.tsp";
 import "./AccountSettingName.tsp";
```

`typespec/lib/models/Account.tsp`, on `Account`:

```diff
+import "../enums/AccountService.tsp";
```

```diff
   @doc("Authentication mechanism used by this account")
   @visibility(Lifecycle.Read)
   authType: AccountAuthType = AccountAuthType.Password;
+
+  @doc("Services this account syncs. Never empty. A password account holds `Mail` alone. Total per RFC 032: the repository read path maps an absent attribute to `#[AccountService.Mail]`, so backend and workers read the same value on a row written before this field existed.")
+  @visibility(Lifecycle.Read)
+  syncedServices: AccountService[] = #[AccountService.Mail];
```

`AccountResponse`:

```diff
       | "authType"
+      | "syncedServices"
       | "imapHost"
```

`CreateAccountInput`:

```diff
+  @doc("Services this account syncs. Defaults to `#[Mail]`. Refused when empty, and refused for a password account unless it is exactly `#[Mail]`.")
+  syncedServices?: AccountService[];
```

`UpdateAccountInput`:

```diff
+  @doc("Replaces the stored service set outright. Refused when empty, on a password account, or when it names a service the account's OAuth grant does not cover. That last case is a consent round trip through the OAuth start route.")
+  syncedServices?: AccountService[];
```

`MicrosoftOAuthStartRequest` in `typespec/main.tsp`:

```diff
   model MicrosoftOAuthStartRequest {
     @doc("Optional email hint for the Microsoft login page")
     email?: string;
+
+    @doc("Services to request consent for. The authorization URL asks for the scopes these map to. Defaults to `#[Mail]`; refused when empty.")
+    services?: AccountService[];
   }
```

### Stage #1185 - read the Graph calendar into the store

Two attributes, and nothing else on the entity. The worker-side entity holding sync state ships with this stage too, outside `CalendarResponse`.

One question stays open for the stage: `CalendarObject.icalData` holds canonical VCALENDAR text, and #1175 does not say whether Graph serves iCalendar bytes per event.

`typespec/lib/enums/CalendarSource.tsp`:

```diff
-@doc("Where a calendar collection came from. `Default` is the one provisioned per account config on first use and is never deleted; `UserCreated` is one a person made; `MailDerived` is one populated from mail rather than by a person.")
+@doc("Where a calendar collection came from. `Default` is the one provisioned per account config on first use and is never deleted; `UserCreated` is one a person made; `MailDerived` is one populated from mail rather than by a person; `ProviderSynced` is one read from an account's provider calendar, which Reader never writes into.")
 enum CalendarSource {
   Default: "Default",
   UserCreated: "UserCreated",
   MailDerived: "MailDerived",
+  ProviderSynced: "ProviderSynced",
 }
```

`typespec/lib/models/CalendarCollection.tsp`:

```diff
   @doc("Owning account configuration")
   @visibility(Lifecycle.Read)
   accountConfigId: UUID;
+
+  @doc("Account that owns this collection. Twenty-five zeros on a collection no account owns, which is every collection whose source is not `ProviderSynced`. `UUID` is pinned to 25 characters, so the sentinel is a zero string of that length rather than an RFC 4122 nil.")
+  @visibility(Lifecycle.Read)
+  accountId: UUID = "0000000000000000000000000";
```

Stage #1184 settles how the account row stores a token per resource, and files that shape itself. This ADR does not decide it.
