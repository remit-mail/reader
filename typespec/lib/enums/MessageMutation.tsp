namespace RemitImap;

@doc("""
  Which mutation a message's placement gave up on. Read it only while
  `syncStatus` is `abandoned` — outside that it is `none` and says nothing,
  the way `originalUid` says nothing once a placement has settled
  (`docs/architecture/imap-mutations.md` R3).
  
  It exists because a hand-back erases the evidence: the give-up puts `status`
  back to `active`, and `status` was the only field naming the mutation that
  was outstanding. Without this the client can see that something was
  abandoned and cannot see what, which is how a move that gave up came to be
  explained to the user as a failed delete.
  """)
enum MessageMutation {
  @doc("No mutation has been abandoned. The ordinary value, on every settled and every in-flight row alike.")
  none: "none",

  @doc("A move the user asked for. The row is back on the folder the server holds it in; the destination is not recorded, so a retry asks for one again.")
  move: "move",

  @doc("A delete the user asked for. The row is back on the folder the server holds it in, and a retry repeats the delete against it.")
  delete: "delete",

  @doc("A copy the user asked for. Its row is `deleted` rather than handed back — the copy never existed on the server — so no listing carries it and no surface reads this value.")
  copy: "copy",
}
