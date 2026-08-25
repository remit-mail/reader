namespace RemitImap;

@doc("Outcome of the most recent manifest check. `ok` when a manifest was fetched and validated, `failed` when it could not be, `disabled` when no manifest URL is configured or no check has ever run (RFC 037 D8).")
enum SystemUpdateCheckStatus {
  ok,
  failed,
  disabled,
}

@doc("Phase of an update run. Advances through the atomic update sequence; `checking` before anything is pulled, `committing` once the new version has answered the gate (RFC 037 R9, R11).")
enum SystemUpdatePhase {
  checking,
  pulling,
  snapshotting,
  stopping,
  starting,
  verifying,
  committing,
  rollingBack,
  recovering,
}

@doc("Terminal outcome of an update run. `null` while a run is in flight; `succeeded` when the new version committed, `rolledBack` when it did not and the previous version was restored, `rollbackFailed` when the restore itself failed and an operator shell is needed, `abandoned` when the run ended having changed nothing (RFC 037 R11).")
enum SystemUpdateOutcome {
  succeeded,
  rolledBack,
  rollbackFailed,
  abandoned,
}

@doc("The most recent manifest check. The check block is independent of the run block: a failed check never renders as a failed update. On `failed` the version fields are absent and an `error` sentence explains why; on `disabled` only the status is present.")
model SystemUpdateCheck {
  @doc("Outcome of the most recent manifest check")
  status: SystemUpdateCheckStatus;

  @doc("When the manifest was last fetched, ISO 8601. Absent when the check is disabled.")
  lastCheckedAt?: string;

  @doc("Latest release version named by the manifest, `vX.Y.Z`. Present when status is `ok`.")
  latestVersion?: string;

  @doc("Publication date of the latest release, ISO 8601. Present when status is `ok`.")
  publishedAt?: string;

  @doc("One authored sentence describing the latest release. Present when status is `ok`.")
  summary?: string;

  @doc("URL of the release notes for the latest release. Present when status is `ok`.")
  releaseNotesUrl?: string;

  @doc("Whether the latest release is newer than the running version. Present when status is `ok`.")
  updateAvailable?: boolean;

  @doc("Schema version of the latest release, from the manifest. Compared against `currentSchemaVersion` to derive whether applying the release runs a migration. Absent when the manifest does not carry it, so a state file written before this field existed still validates.")
  schemaVersion?: int32;

  @doc("Plain sentence naming why the check failed. Present when status is `failed`.")
  error?: string;
}

@doc("The current or last update run. `null` when no run has ever started. `outcome` is `null` while a run is in flight. `message` and `logCommand` are rendered to the operator verbatim: a plain sentence naming the cause and a command that can be pasted into a shell to see more (RFC 037 Interface).")
model SystemUpdateRun {
  @doc("Opaque id of this run; the client persists it and treats subsequent request failures as an in-progress apply until the surface answers")
  runId: string;

  @doc("Version the run started from, `vX.Y.Z`")
  fromVersion: string;

  @doc("Version the run is installing, `vX.Y.Z`")
  targetVersion: string;

  @doc("Phase the run is in")
  phase: SystemUpdatePhase;

  @doc("Terminal outcome, or `null` while the run is in flight")
  outcome: SystemUpdateOutcome | null;

  @doc("When the run started, ISO 8601")
  startedAt: string;

  @doc("When the run state was last written, ISO 8601")
  updatedAt: string;

  @doc("Plain sentence naming the current cause, rendered to the operator verbatim")
  message: string;

  @doc("A command that can be pasted into a shell to see more, rendered to the operator verbatim")
  logCommand: string;
}

@doc("The self-update resource: the running version, the outcome of the most recent manifest check, and the state of the current or last run. One read serves every interface state. The check block and the run block are independent by construction (RFC 037 D7).")
model SystemUpdateResponse {
  @doc("The version the instance is currently running, `vX.Y.Z` (or a non-release tag such as `latest`)")
  currentVersion: string;

  @doc("Schema version the running instance is on, written by the wrapper at check time. The consent UI derives that applying a release runs a migration from `check.schemaVersion` being greater than this. Absent when unknown, so a state file written before this field existed still validates.")
  currentSchemaVersion?: int32;

  @doc("The most recent manifest check")
  check: SystemUpdateCheck;

  @doc("The current or last update run, or `null` when no run has ever started")
  run: SystemUpdateRun | null;
}

@doc("Request to install a specific release. `targetVersion` must equal the version the latest check reported; the backend passes exactly this one field across the control seam and resolves nothing else (RFC 037 R6).")
model ApplyUpdateInput {
  @doc("The release version to install, `vX.Y.Z`")
  targetVersion: string;
}
