@doc("Storage backend types for message and body part content")
enum StorageType {
  @doc("Amazon S3 or compatible object storage")
  S3: "s3",

  @doc("Local or network filesystem")
  Filesystem: "filesystem",

  @doc("Stored inline in database")
  Inline: "inline",

  @doc("Stored in database BLOB/TEXT column")
  Database: "database",
}
