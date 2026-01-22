@doc("Group address per RFC 2822 Section 3.4. Groups allow multiple mailboxes to be addressed as a named unit (e.g., 'Committee: john@example.com, jane@example.com;').")
model AddressGroup {
  @doc("Primary identifier")
  addressGroupId: string;

  @doc("Group name (the display-name part before the colon)")
  @minLength(1)
  displayName: string;
}

@doc("Links addresses to groups, maintaining order within the group")
model GroupMember {
  @doc("Primary identifier")
  groupMemberId: string;

  @doc("Reference to the parent group")
  addressGroupId: string;

  @doc("Reference to the member address")
  addressId: string;

  @doc("Order within the group (0-indexed)")
  @minValue(0)
  memberOrder: int32;
}
