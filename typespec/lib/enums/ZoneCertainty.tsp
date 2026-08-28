namespace RemitImap;

@doc("How confidently a stored time was placed on the clock. A calendar that cannot say this hides its worst failure: an event read in the wrong zone is off by hours and looks exactly like an event read correctly.")
enum ZoneCertainty {
  @doc("The time named no zone at all and was read in the collection's timezone. Correct for the writer who meant local time, wrong for a reader in another zone — RFC 5545 floating time by design.")
  Local: "Local",

  @doc("The time named a zone that resolved: UTC, a TZID defined by a VTIMEZONE in the resource, or an IANA TZID this platform knows.")
  Explicit: "Explicit",

  @doc("The time named a zone nothing could resolve — a Windows zone name with no VTIMEZONE, a typo. It was read in the next fallback, so the instant may be wrong by whatever those zones differ by.")
  Ambiguous: "Ambiguous",
}
