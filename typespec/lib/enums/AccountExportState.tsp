namespace RemitImap;

@doc("Lifecycle state of an account export request")
enum AccountExportState {
  @doc("Export request received; worker not yet started")
  Pending: "Pending",

  @doc("Worker is building the ZIP archive")
  Processing: "Processing",

  @doc("Archive is ready; downloadUrl is set")
  Ready: "Ready",

  @doc("Export failed; errorMessage describes the cause")
  Failed: "Failed",
}
