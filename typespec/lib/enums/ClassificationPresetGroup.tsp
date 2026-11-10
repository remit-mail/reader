namespace RemitImap;

@doc("How a settings screen groups the classification presets. `Hosted` is a named provider, `Custom` an endpoint the reader names, `Local` a model on the reader's own machine.")
enum ClassificationPresetGroup {
  Hosted: "Hosted",
  Custom: "Custom",
  Local: "Local",
}
