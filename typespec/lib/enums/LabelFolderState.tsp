namespace RemitImap;

@doc("Whether a label's folder exists in one mail account.")
enum LabelFolderState {
  @doc("The folder is synced.")
  Present: "Present",

  @doc("The mail server has not confirmed the folder yet.")
  Pending: "Pending",

  @doc("The account holds no folder for the label.")
  Missing: "Missing",
}
