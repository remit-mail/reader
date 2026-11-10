# Where a new fact is stored

## The rule

A feature puts a new fact in an existing store. A new table or a new column needs a stated reason that no existing store can hold the fact. That reason goes in the issue, before any `.tsp` change.

Metrics, counters and failure history that no screen reads back go to `packages/logger`. They never go in a table.

## Store definitions

- Settings: the `AccountSetting` entity in `typespec/lib/models/AccountSetting.tsp`, read and written by `packages/backend/src/handlers/user-settings.ts`.
- Secrets: `packages/secrets-service`.
- Labels: `typespec/lib/models/Label.tsp` and `typespec/lib/models/MessageLabel.tsp`, plus the filter pipeline in `packages/mailbox-service/src/filters/pipeline.ts`.
- Entity tables: the TypeSpec models in `typespec/lib/models`.
