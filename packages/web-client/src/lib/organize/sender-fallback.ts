import type { RemitImapOrganizeInput } from "@remit/api-http-client/types.gen.ts";
import { deriveSenderClauses } from "@remit/ui";
import type { OrganizeDraft } from "./organize-model";

/**
 * The widen fallback for a deployment that ships no vector pipeline (self-host
 * sqlite — semantic-capability.ts). The semantic anchor matches nothing there,
 * so a widen degrades to the literal vocabulary RFC 031 already matches
 * vector-free: the sender clauses `@remit/ui` derives, combined with `Or`, no
 * anchor. The same predicate matches at index time (RFC 034), so a standing
 * filter built from it keeps working on future mail.
 */

/**
 * The literal predicate that stands in for the semantic anchor: the sender
 * clauses combined with `Or` and no anchor. The preview, the one-time
 * back-apply, and the standing filter all carry exactly this.
 */
export const buildSenderFallbackDraft = (
	senders: readonly string[],
): OrganizeDraft => ({
	matchOperator: "Or",
	literalClauses: deriveSenderClauses(senders),
});

/**
 * The predicate the widen previewed, handed to the organize sentence so the set
 * it previews equals the set every commit scope acts on. Either the semantic
 * anchor or the sender-derived literal fallback, never both.
 */
export type OrganizeMatchPredicate = Pick<
	RemitImapOrganizeInput,
	"anchorMessageId" | "matchOperator" | "literalClauses"
>;
