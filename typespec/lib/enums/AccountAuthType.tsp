namespace RemitImap;

@doc("Authentication mechanism used by an email account")
enum AccountAuthType {
  @doc("Traditional password-based authentication (IMAP LOGIN / AUTH PLAIN)")
  Password: "password",

  @doc("Microsoft OAuth 2.0 XOAUTH2 — token managed via the OAuth connect flow")
  OauthMicrosoft: "oauthMicrosoft",
}
