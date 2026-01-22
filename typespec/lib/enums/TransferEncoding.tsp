@doc("MIME transfer encodings per RFC 2045")
enum TransferEncoding {
  @doc("7-bit ASCII text")
  SevenBit: "7BIT",

  @doc("8-bit data")
  EightBit: "8BIT",

  @doc("Binary data")
  Binary: "BINARY",

  @doc("Base64 encoded")
  Base64: "BASE64",

  @doc("Quoted-printable encoded")
  QuotedPrintable: "QUOTED-PRINTABLE",
}
