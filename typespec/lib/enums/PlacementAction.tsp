namespace RemitImap;

@doc("Actionable placement verdict — the direction Remit decided to move a message. `leave` is not represented: a left-in-place verdict means the placement sub-model is absent.")
enum PlacementAction {
  MoveToInbox: "MoveToInbox",
  MoveToJunk: "MoveToJunk",
}
