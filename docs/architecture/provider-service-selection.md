# Which services an account syncs

An Outlook or Gmail account syncs mail only, calendar only, or both.

## D1 - an account carries a set of the services it syncs

`Account` carries `syncedServices: AccountService[]`, defaulting to `#[AccountService.Mail]`.

Two booleans spread the "one service or more" rule across two fields, so no single write validates on its own, and storage can hold the empty choice that D6 refuses. A third service then costs a third field and a third clause at every call site, where a set costs one enum member. `POST /accounts/oauth/microsoft/start` maps the set straight onto a scope list.

`isActive: false` is the deletion tombstone fence the workers read, so it cannot carry "mail off, calendar on".

## D2 - the set holds `Mail` and `Calendar`, and a password account holds `Mail`

Microsoft and Google both separate mail from calendar at the scope level, so an operator can grant one without the other. A `Password` account holds `#[Mail]`, and the account endpoints refuse any other value for it.

## D5 - the mail surfaces read only mail-syncing accounts

The mail list, the brief and search read their accounts through `listMailSourcesByAccountConfig`, which selects only accounts whose `syncedServices` hold `Mail`. A calendar-only account and an account that stopped syncing mail both drop out of those surfaces. The stopped account keeps the rows it holds, those rows stop changing, and its mailboxes still open when addressed directly.

The mail sync worker skips an account without `Mail`, and the send path refuses one with `mail_sync_off`, naming the toggle rather than the SMTP configuration.

## D6 - the API boundary refuses an empty set

`POST /accounts`, `PATCH /accounts/{accountId}` and the OAuth start endpoint answer 400 on an empty `syncedServices`. No stored row ever holds it, so no worker handles it.

`PATCH` also answers 400 when the new set names a service the account's OAuth grant never covered, and the error names `POST /accounts/oauth/microsoft/start` as the route. Adding a service is a consent round trip: the scopes come from the authorization request, so a PATCH alone cannot grant them, and it leaves a row claiming a service the token cannot reach.

`isActive: false` cannot mean "syncs nothing". That flag is the tombstone fence and pairs with `deletedAt`, so reusing it makes a live account read the same as one the cascade is deleting. `DELETE /accounts/{accountId}` is the route to syncing nothing.
