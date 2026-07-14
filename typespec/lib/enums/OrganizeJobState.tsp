namespace RemitImap;

@doc("Lifecycle state of a smart-organize back-apply job (RFC 034, #1278). Mirrors the account-export job's lifecycle: a Pending row the worker picks up, drives to Running, then to a terminal Complete or Failed.")
enum OrganizeJobState {
  @doc("Job received; worker not yet started")
  Pending: "Pending",

  @doc("Worker is matching the corpus and applying the action")
  Running: "Running",

  @doc("Every matching message has had the action applied; counts are final")
  Complete: "Complete",

  @doc("Job failed; errorMessage describes the cause")
  Failed: "Failed",
}
