import "typespec-electrodb-emitter";
import "@typespec/http";

import "../enums/ConfigImportMode.tsp";
import "../enums/ConfigImportOnExisting.tsp";
import "../enums/ConfigImportRefKind.tsp";
import "../enums/ConfigImportState.tsp";
import "../errors.tsp";
import "../scalars/string.tsp";

using TypeSpec.Http;

namespace RemitImap;

@doc("""
  A folder reference an import could not bind yet. Every folder in a
  configuration file is named by IMAP path, because mailbox ids are regenerated
  by each discovery, and a fresh database holds no mailboxes at all until IMAP
  has been read. The reference is recorded rather than dropped or guessed, and
  the binder writes the row it belongs to once the path resolves.
  """)
model ConfigImportUnresolvedRef {
  @doc("Which piece of configuration this reference belongs to")
  kind: ConfigImportRefKind;

  @doc("The account whose folders this path resolves against")
  accountId: UUID;

  @doc("The IMAP path, as the exporting instance spelled it")
  folderPath: String512;

  @doc("The role for a folder role, the folder path for a mailbox override, the filter id for a filter's move action")
  target: String256;
}

@doc("""
  One applied configuration import (#1021). It exists because a file's folder
  references cannot bind at apply time: IMAP discovery produces the mailboxes,
  minutes to hours later, and the ids it assigns are new every run.
  
  The row keeps the document as applied — credential-stripped, like the file
  itself — so the binder can re-read the payload behind each reference instead
  of copying it, and so a person can see what was imported after the fact.
  """)
@entity("configImport", "remit")
@index(
  "ConfigImport",
  {
    pk: [ConfigImport.importId],
    sk: [],
  }
)
@index(
  "byAccountConfigId",
  {
    index: "gsi0",
    pk: [ConfigImport.accountConfigId],
    sk: [ConfigImport.createdAt],
  }
)
model ConfigImport {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  importId: UUID;

  @doc("The configuration this file was imported into — the caller's own, never the one the file records as its provenance")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Schema version of the document as applied, after migration")
  @visibility(Lifecycle.Read)
  schemaVersion: int32;

  @doc("Whether every folder reference has been bound")
  @visibility(Lifecycle.Read)
  state: ConfigImportState = ConfigImportState.Pending;

  @doc("The document as applied. Carries no credential, for the same reason the file does not.")
  @visibility(Lifecycle.Read)
  document: Record<unknown>;

  @doc("Folder references still waiting for a mailbox. Emptied by the binder as discovery resolves each path; an empty list is what makes the import Complete.")
  @visibility(Lifecycle.Read)
  unresolvedRefs: ConfigImportUnresolvedRef[] = #[];

  @doc("Epoch millis when the import was applied")
  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @doc("Epoch millis when the last folder reference was bound; `0` while the import is still Pending")
  @visibility(Lifecycle.Read)
  completedAt: int64 = 0;

  @doc("Epoch millis when the row was last written")
  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

// ============================================
// API Models
// ============================================

@doc("Request body for POST /config/import")
model ImportConfigInput {
  @doc("`validate` writes nothing; `apply` writes.")
  mode?: ConfigImportMode = ConfigImportMode.Validate;

  @doc("What to do when this configuration is not empty.")
  onExisting?: ConfigImportOnExisting = ConfigImportOnExisting.Abort;

  @doc("The config document, as exported.")
  document: Record<unknown>;
}

@doc("What became of one item in the submitted document")
model ConfigImportItemReport {
  @doc("Which section: accounts | labels | filters | addressFlags | settings")
  section: string;

  @doc("Human key of the item - an email, a label name, a filter name")
  key: string;

  @doc("created | updated | unchanged | skipped | rejected")
  verdict: string;

  @doc("Why, when the verdict is skipped or rejected")
  reason?: string;
}

@doc("The outcome of a validate or an apply. A rejected document is an answer, not a failure: `valid` is false and `errors` says why.")
model ConfigImportReport {
  @doc("Import identity; present on apply, so the folder bindings this import is still waiting on can be named later")
  importId?: UUID;

  @doc("Whether the document is importable at all")
  valid: boolean;

  @doc("Schema version of the submitted document")
  schemaVersion: int32;

  @doc("Whether anything was written")
  applied: boolean;

  @doc("Per-item verdicts")
  items: ConfigImportItemReport[];

  @doc("Blocking problems; non-empty means nothing was written")
  errors: ApiError[];

  @doc("Non-blocking notes - e.g. a folder path this account does not hold yet")
  warnings: ApiError[];

  @doc("Accounts that landed needing a credential before they can sync")
  accountsNeedingCredentials: UUID[];
}

@doc("""
  The import was refused because this configuration is not empty. The body is
  flat: `code`, `message` and `details` sit at the top level.
  
  `code: "config_not_empty"` — the configuration already holds an account, a
  label, a filter or an address flag. `details` names how many of each. Re-send
  with `onExisting: merge` to upsert instead.
  """)
model ConfigImportConflict {
  @statusCode statusCode: 409;
  ...ApiError;
}

@doc("""
  An import that is still waiting for IMAP discovery to produce the folders its
  file named. The folder appointed to a role, a folder's own display name or
  mute, and a filter's move destination are all bound by path; a path this
  account does not hold yet is kept, not guessed, and bound the moment discovery
  finds it.
  """)
model PendingConfigImport {
  @doc("The import still waiting")
  importId: UUID;

  @doc("The IMAP paths no mailbox answers to yet, deduplicated")
  folderPaths: string[];
}
