# Which services an account syncs, and where a provider calendar lives

Status: proposed
Scope: `Account`, `CalendarCollection`, `CalendarSource`, the account endpoints, and the mail and calendar sync workers. Settles the two model questions epic #1174 blocks on. Stages #1180 and #1185 file the shapes at the end for approval.

## Context

An Outlook or Gmail account must sync calendar only, mail only, or both (#1174). Two model facts block every implementation stage.

`Account` says nothing about which services it syncs. `isActive: false` is the deletion tombstone fence three workers read (`packages/account-worker/src/handlers/account-fanout.ts:114`, `.../account-finalize.ts:46`, `packages/imap-worker/src/events.ts:197`), so it cannot carry "mail off, calendar on".

`CalendarCollection` is keyed on `accountConfigId` and carries no `accountId`. A calendar belongs to the person. A provider calendar belongs to one account, and switching that account's calendar sync off must stop that calendar alone.

The research answers filed on #1175 (Microsoft Graph) and #1176 (Google) are the grounds cited below. The epic's invariants 1 to 7 bind every decision here.

## Decisions

### D1 - an account carries a set of the services it syncs

`Account` carries `syncedServices: AccountService[]`, defaulting to `#[AccountService.Mail]`.

Two booleans spread the "one service or more" rule across two fields, so no single write validates on its own, and storage can hold the empty choice that D6 refuses. A third service then costs a third field and a third clause at every call site, where a set costs one enum member. `Mailbox.specialUse` is the precedent for an enum set on a row. `POST /accounts/oauth/microsoft/start` maps the set straight onto a scope list, which is what invariant 3 asks of onboarding (#1175 section 2).

Buys: one field to validate and one value to map to scopes. Gives up: a membership test at each read site instead of a boolean read.

### D2 - the set holds `Mail` and `Calendar`, and an IMAP account holds `Mail`

Microsoft and Google both separate mail from calendar at the scope level. Microsoft puts `Mail.ReadWrite`, `Mail.Send` and `Calendars.Read` on one Graph resource and makes each consentable on its own (#1175). Google puts mail behind `https://mail.google.com/` and calendar behind `calendar.readonly` (#1176). The mail scope is restricted tier: it costs a CASA assessment and an annual Letter of Assessment. The calendar scope is sensitive tier and costs neither. So for Google the two services differ by verification tier, and an operator ships one without the other. Contacts and CardDAV are out of scope for the epic (#14).

A `Password` account holds `#[Mail]`, and the account endpoints refuse any other value for it (invariant 4). Rows written before the field exists read back as `#[Mail]`: the default applies on write only, so the read path coalesces, the way `smtpEnabled` and `cursorState` already do (`packages/backend/src/handlers/account-guards.ts:113`). No migration runs.

### D3 - a provider calendar is an account-owned `CalendarCollection`

`CalendarCollection` takes an `accountId` and a `byAccountId` index on `gsi1`. `CalendarSource` takes a fourth member, `ProviderSynced`. A collection no account owns carries the nil UUID.

The `.ics` feed, `/calendars`, `/calendar-events`, free-busy and the CalDAV path all read `CalendarCollection` today. A separate provider-calendar entity doubles every one of those read paths. The primary index stays `pk accountConfigId, sk calendarId`, so a person's calendar list is one query and no DAV path changes.

A provider collection derives its `urlSegment` from the account id and the provider's own calendar id. A sync round then re-provisions the same row, and two Outlook accounts under one config never collide on a segment.

Reader answers 400 to its own write into a `ProviderSynced` collection, the refusal `deleteCalendar` already gives for the default collection (`typespec/main.tsp:387`). Sync runs one way (invariant 7), so an event written here loses to the next round.

### D4 - switching calendar sync off deletes nothing and writes nothing

The collection, its `CalendarObject` rows, its `syncSequence` and its feed token all stay. `/calendars` still lists it, `/calendar-events` still returns its events, and `/feeds/calendar` serves the iCalendar text it served before. The content freezes at the last completed sync round.

Invariant 1 states that disable is not delete. Each calendar mints and revokes its own feed token (`typespec/main.tsp:409`, `typespec/main.tsp:425`), so a subscriber starts getting 404 once someone revokes that token. A service toggle is a different act.

### D5 - the mail surfaces read stored rows

The mail list, the brief, search and folder appointments read stored rows and never look at `syncedServices`. A calendar-only account owns no mailboxes and no messages, so it reaches none of those surfaces and none of them needs to know why (invariant 5). An account that stops syncing mail keeps the rows it holds, and those rows stop changing (invariant 1).

Two paths read the service set. The mail sync worker skips an account without `Mail` (#1181). The send path refuses one, and it checks the set ahead of `smtpEnabled` so the error names the toggle instead of the SMTP configuration. `smtpEnabled` keeps its RFC 032 meaning of "this account has working SMTP configuration" and answers second.

Settings keeps listing the account, because that is where the toggle lives (#1179).

### D6 - the API boundary refuses an empty set

`POST /accounts`, `PATCH /accounts/{accountId}` and the OAuth start endpoint answer 400 on an empty `syncedServices`. No stored row ever holds it, so no worker handles it.

`isActive: false` cannot mean "syncs nothing". That flag is the tombstone fence and pairs with `deletedAt`, so reusing it makes a live account read the same as one the cascade is deleting. `DELETE /accounts/{accountId}` is the route to syncing nothing, and it already exists. #1179 points there when the person switches the last service off.

### D7 - re-enabling resumes from the stored cursor and falls back to a full sync

A toggle never clears a cursor. The first round after re-enabling sends the stored delta or sync token, and starts a full sync when the provider rejects it.

Both providers already make that fallback ordinary. Microsoft gives Outlook delta tokens no fixed lifetime, because the cache evicts them, and reports expiry as `410 Gone` with an empty `$deltatoken` or a 40X `syncStateNotFound` (#1175 section 4). Google answers an expired `syncToken` with `410 GONE` and tells the client to clear storage and resynchronize (#1176 section 7). So re-enabling needs no code path scheduled sync lacks, and the fallback is cheap: #1175 puts a one-year window at `odata.maxpagesize=50` under ten requests, against 10,000 per 10 minutes per mailbox.

Two constraints follow. The sync window stays fixed across a toggle, because Microsoft bakes it into the delta token and widening it forces a full resync. And a full resync must diff the collection against the returned set and drop what the provider dropped, because a resync carries no `@removed` entries.

A mail resume needs one more step. Graph can miss a change notification when a message moves out of a folder and back in (#1175 section 8), so #1181 runs a reconciliation pass and re-enabling schedules it before the first delta round.

## The TypeSpec changes these stages file for approval

Both sets are additive: new optional request fields, new response fields, one new enum, one new enum member and one new index. The epic pre-approves the surface; each stage still files the exact shape below.

### Stage #1180 - an account declares the services it syncs

New file `typespec/lib/enums/AccountService.tsp`:

```typespec
namespace RemitImap;

@doc("A service an account syncs. `Mail` covers messages, folders and sending; `Calendar` covers a provider calendar read into the calendar store. An account carries a non-empty set of these (ADR provider-service-selection, D1 and D2).")
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
+  @doc("Services this account syncs (ADR provider-service-selection, D1). Never empty: the account endpoints refuse an empty set (D6). A password account holds `Mail` alone (D2). Total per RFC 032: the ElectroDB default applies on write only, so a row written before this field existed reads back as `#[AccountService.Mail]`.")
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
+  @doc("Replaces the stored service set outright. Refused when empty (ADR provider-service-selection, D6) and refused on a password account (D2). Adding a service the first consent never covered sends the person back to the provider (epic #1174, invariant 6).")
+  syncedServices?: AccountService[];
```

`MicrosoftOAuthStartRequest` in `typespec/main.tsp`:

```diff
   model MicrosoftOAuthStartRequest {
     @doc("Optional email hint for the Microsoft login page")
     email?: string;
+
+    @doc("Services to request consent for. The authorization URL asks for the scopes these map to, so the consent screen matches what the person picked (epic #1174, invariant 3). Defaults to `#[Mail]`; refused when empty.")
+    services?: AccountService[];
   }
```

### Stage #1185 - read the Graph calendar into the store

One question stays open for this stage: `CalendarObject.icalData` holds canonical VCALENDAR text, and #1175 does not say whether Graph serves iCalendar bytes per event.

`typespec/lib/enums/CalendarSource.tsp`:

```diff
-@doc("Where a calendar collection came from. `Default` is the one provisioned per account config on first use and is never deleted; `UserCreated` is one a person made; `MailDerived` is one populated from mail rather than by a person.")
+@doc("Where a calendar collection came from. `Default` is the one provisioned per account config on first use and is never deleted; `UserCreated` is one a person made; `MailDerived` is one populated from mail rather than by a person; `ProviderSynced` is one read from an account's provider calendar, which Reader never writes into (ADR provider-service-selection, D3).")
 enum CalendarSource {
   Default: "Default",
   UserCreated: "UserCreated",
   MailDerived: "MailDerived",
+  ProviderSynced: "ProviderSynced",
 }
```

`typespec/lib/models/CalendarCollection.tsp`, a new index alongside `byUrlSegment`:

```diff
+@index(
+  "byAccountId",
+  {
+    index: "gsi1",
+    pk: [CalendarCollection.accountId],
+    sk: [CalendarCollection.calendarId],
+  }
+)
 model CalendarCollection {
```

and four attributes on the model:

```diff
   @doc("Owning account configuration")
   @visibility(Lifecycle.Read)
   accountConfigId: UUID;
+
+  @doc("Account that owns this collection (ADR provider-service-selection, D3). Carries the nil UUID on a collection no account owns, which is every collection whose source is not `ProviderSynced`. Switching an account's calendar sync off stops exactly the collections this index returns.")
+  @visibility(Lifecycle.Read)
+  accountId: UUID = "00000000-0000-0000-0000-000000000000";
+
+  @doc("The provider's own identifier for this calendar. `\"\"` when no provider owns it. `urlSegment` is derived from `accountId` and this value, so a sync round re-provisions this row instead of writing a second one.")
+  @visibility(Lifecycle.Read)
+  providerCalendarId: String512 = "";
+
+  @doc("Opaque delta or sync token from the last completed provider round. `\"\"` means the next round is a full sync, which is the state a `410 Gone` or a `syncStateNotFound` leaves behind. A service toggle never clears it (ADR provider-service-selection, D7).")
+  @visibility(Lifecycle.Read)
+  providerSyncToken: string = "";
+
+  @doc("Start of the sync window the delta token was issued against, ISO 8601 with an explicit offset. `\"\"` when no provider owns this collection. Microsoft bakes the window into the token, so changing this value forces a full resync.")
+  @visibility(Lifecycle.Read)
+  providerSyncWindowStart: string = "";
+
+  @doc("End of the sync window, ISO 8601 with an explicit offset. `\"\"` when no provider owns this collection.")
+  @visibility(Lifecycle.Read)
+  providerSyncWindowEnd: string = "";
```

Stage #1184 settles how the account row stores a token per resource, and files that shape itself. This ADR does not decide it.
