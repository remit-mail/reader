namespace RemitImap;

@doc("The stable name of one check the spam service ran and found something with (RFC 041). A client holds one sentence per name.")
enum SpamReasonName {
  @doc("Check 1: DMARC failed.")
  DmarcFail: "DmarcFail",

  @doc("Check 1: the message is signed by a different registrable domain than its sender's.")
  SignerMismatch: "SignerMismatch",

  @doc("Check 2: the Reply-To domain differs from the From domain.")
  ReplyToMismatch: "ReplyToMismatch",

  @doc("Check 3: a link's visible text shows a domain other than the one it points to.")
  LinkTextMismatch: "LinkTextMismatch",

  @doc("Check 4: a link points to a domain far from the sender's.")
  LinkDomainDistant: "LinkDomainDistant",

  @doc("Check 5: a domain label is punycode.")
  PunycodeDomain: "PunycodeDomain",

  @doc("Check 5: a domain label mixes scripts.")
  MixedScriptDomain: "MixedScriptDomain",

  @doc("Check 5: two different domains in the message look the same.")
  ConfusableDomains: "ConfusableDomains",

  @doc("Check 6: rich HTML carries a single link, and it leaves the sender's domain.")
  SingleOffDomainLink: "SingleOffDomainLink",

  @doc("Check 7: the sender's domain or local part looks generated.")
  GeneratedName: "GeneratedName",

  @doc("Check 8: the sender's domain has sent this account nothing before.")
  FirstContactDomain: "FirstContactDomain",

  @doc("Check 8: the sender's domain was registered recently.")
  RecentlyRegisteredDomain: "RecentlyRegisteredDomain",

  @doc("Check 8: the registry publishes no registration date for the sender's domain.")
  UnknownRegistrationDate: "UnknownRegistrationDate",

  @doc("Check 9: the category classifier gave Spam a confident score.")
  ClassifierSpam: "ClassifierSpam",

  @doc("Check 9: the category classifier gave Phishing a confident score.")
  ClassifierPhishing: "ClassifierPhishing",

  @doc("Check 10: the owner's mail provider calls the message spam.")
  ProviderSpam: "ProviderSpam",

  @doc("Check 11: the display name spells out an address at another domain.")
  DisplayNameForeignAddress: "DisplayNameForeignAddress",

  @doc("Check 11: the display name sits a short edit distance from a sender or link domain label.")
  DisplayNameLookalike: "DisplayNameLookalike",

  @doc("Stage 3: the model judged that the message claims an organisation its sender's domain does not belong to. `options` quotes the model's reason.")
  ModelImpersonation: "ModelImpersonation",

  @doc("Stage 3: the model judged the message spam. `options` quotes the model's reason.")
  ModelSpam: "ModelSpam",

  @doc("Stage 3: the model judged the message legitimate. `options` quotes the model's reason.")
  ModelClean: "ModelClean",

  @doc("Stage 3 was skipped: the account has no model configured.")
  ModelNotConfigured: "ModelNotConfigured",

  @doc("Stage 3 was skipped: the account reached its daily model limit.")
  ModelDailyLimit: "ModelDailyLimit",

  @doc("Stage 3 was skipped: the model provider refused the call for its rate limit.")
  ModelRateLimited: "ModelRateLimited",

  @doc("Stage 3 was skipped: the model call failed or its answer could not be read.")
  ModelFailed: "ModelFailed",

  @doc("A backend symbol with no name of its own here, such as an rspamd rule. The reason's `symbol` carries it.")
  BackendSymbol: "BackendSymbol",
}
