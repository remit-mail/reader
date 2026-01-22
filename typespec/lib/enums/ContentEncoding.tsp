namespace RemitImap;

@doc("Content encoding/compression types for stored content")
enum ContentEncoding {
  @doc("No compression applied")
  None: "none",

  @doc("Gzip compression")
  Gzip: "gzip",

  @doc("Zstandard compression")
  Zstd: "zstd",
}
