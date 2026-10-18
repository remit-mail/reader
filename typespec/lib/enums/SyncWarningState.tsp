namespace RemitImap;

@doc("Whether sync still retries a warned message. Derived from stage and attempts, never stored.")
enum SyncWarningState {
  @doc("Sync tries the message again every round.")
  Retrying: "Retrying",

  @doc("Body sync has reached its attempt ceiling and stopped trying.")
  GaveUp: "GaveUp",
}
