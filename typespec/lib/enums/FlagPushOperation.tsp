namespace RemitImap;

@doc("The IMAP flag transition a pending flag-push marker (issue #1273, epic #1281) will apply once pushed: add the flag, or remove it. Captured once, when the marker is written — the push never re-derives the desired transition from the current `MessageFlag`/`ThreadMessage` row at push time, since a newer local flip of the SAME field would have already replaced the marker (epic FAQ — 'a flag flip replaces a pending flag flip').")
enum FlagPushOperation {
  add: "add",
  remove: "remove",
}
