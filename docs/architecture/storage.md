# Where a new fact is stored

Scope: every feature that persists something new. Reader already has stores for settings, secrets and labels. A new fact goes into one of them.

## The stores

`AccountSetting` holds the user's settings as key-value rows (`typespec/lib/models/AccountSetting.tsp`). Each row belongs to one account config and carries a name from `AccountSettingName`. A setting for one account or one mailbox appends the target id to the name, as in `AccountSignatureHtml#<accountId>`. A value is a boolean, a string, a number, a string list, a string map or a mute flag. The registry in `packages/data-ports/src/account-settings.ts` binds each name to its value kind. `getUserSettings` and `updateUserSettings` in `packages/backend/src/handlers/user-settings.ts` read and write these rows.

`packages/secrets-service` encrypts and decrypts with AWS KMS envelope encryption. It stores nothing. The caller serializes the encrypted payload to base64 strings and keeps them in an existing store. Each `Account` row holds its password and its OAuth refresh token this way.

`Label` and `MessageLabel` hold Remit's own labels (`typespec/lib/models/Label.tsp`, `typespec/lib/models/MessageLabel.tsp`). A `Label` row is a label definition. A `MessageLabel` row puts one label on one message. The filter pipeline in `packages/mailbox-service/src/filters/pipeline.ts` decides which labels a synced message gets. `appliedByFilterId` on the row names the filter that applied it.

The entity tables come from the TypeSpec models under `typespec/lib/models`. A generator turns them into the Drizzle schema, so a table or a column starts as a `.tsp` change.

## The rule

A feature puts a new fact in an existing store. User preferences become a new `AccountSettingName` member plus a registry entry. Secrets go through secrets-service into an existing row. Tags on a message become labels.

A new table or a new column needs a stated reason that none of these stores can hold the fact. That reason goes in the issue, before any `.tsp` change.

## Logs

A metric, a counter or a failure history that no screen reads back goes to structured logging through `packages/logger`. It never goes in a table. The logger writes one JSON object per line, and an operator's log pipeline parses those fields.

## Before you add a table

1. Name the screen or the API response that reads the fact back. With none, log it.
2. Check whether an `AccountSettingName` member with an existing value kind holds it.
3. Check whether a label holds it.
4. Write the reason each store fails into the issue.
