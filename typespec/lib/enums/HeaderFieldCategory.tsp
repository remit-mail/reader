@doc("Header field categories per RFC 2822 Section 3.6")
enum HeaderFieldCategory {
  @doc("Origination date field (Date) - RFC 2822 Section 3.6.1")
  Origination: "origination",

  @doc("Originator fields (From, Sender, Reply-To) - RFC 2822 Section 3.6.2")
  Originator: "originator",

  @doc("Destination fields (To, Cc, Bcc) - RFC 2822 Section 3.6.3")
  Destination: "destination",

  @doc("Identification fields (Message-ID, In-Reply-To, References) - RFC 2822 Section 3.6.4")
  Identification: "identification",

  @doc("Informational fields (Subject, Comments, Keywords) - RFC 2822 Section 3.6.5")
  Informational: "informational",

  @doc("Resent fields - RFC 2822 Section 3.6.6")
  Resent: "resent",

  @doc("Trace fields (Return-Path, Received) - RFC 2822 Section 3.6.7")
  Trace: "trace",

  @doc("Optional/extension fields - RFC 2822 Section 3.6.8")
  Optional: "optional",
}
