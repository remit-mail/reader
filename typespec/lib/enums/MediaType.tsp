@doc("Top-level MIME media types per RFC 2046")
enum MediaType {
  @doc("Textual information")
  Text: "TEXT",

  @doc("Image data")
  Image: "IMAGE",

  @doc("Audio data")
  Audio: "AUDIO",

  @doc("Video data")
  Video: "VIDEO",

  @doc("Application-specific data")
  Application: "APPLICATION",

  @doc("Multiple body parts")
  Multipart: "MULTIPART",

  @doc("Encapsulated message")
  Message: "MESSAGE",
}
