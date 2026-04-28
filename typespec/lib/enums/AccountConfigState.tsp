namespace RemitImap;

@doc("Lifecycle state of an account configuration")
enum AccountConfigState {
  @doc("Account is active and operational")
  Active: "active",

  @doc("Account is being deleted; cascading cleanup in progress")
  Deleting: "deleting",
}
