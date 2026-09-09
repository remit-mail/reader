import type {
	IAddressRepository,
	ThreadMessageItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { deriveAddressId } from "@remit/data-ports/id";
import type { ParsedMail } from "mailparser";
import {
	classifyByHeaders,
	extractAuthenticity,
	extractAuthResult,
	extractHasListUnsubscribe,
	extractProviderSpam,
} from "./heuristics/classifyByHeaders.js";
import { extractSenderMismatch } from "./heuristics/senderMismatch.js";

type ThreadMessageCategory = ThreadMessageItem["category"];

/**
 * The From address the classifier reads, when there is one to read. Shared by
 * every path that classifies or counts a sender (body-sync's classification,
 * inbound counter and placement signals, and the classification backfill) so
 * they all read the same address off the same bytes.
 */
export const extractPrimaryFromEmail = (parsed: ParsedMail): string | null => {
	const from = parsed.from;
	if (!from || !from.value || from.value.length === 0) return null;
	const address = from.value[0]?.address;
	if (!address) return null;
	return address.toLowerCase();
};

/**
 * The one-sided half of `Address.flags.category` (issue #299, RFC 039
 * Decision 3): a real value here overrides `classifyByHeaders` outright.
 * Only a genuinely-absent Address is "no override" — any other failure
 * (throttle, infra) propagates, because this feeds the write-once
 * `Message.category` at the moment it is decided, where a masked infra
 * failure would silently classify by headers when the user asked for
 * something else.
 */
const resolveCategoryOverride = async (
	addressService: Pick<IAddressRepository, "getAddress">,
	accountConfigId: string,
	fromEmail: string,
): Promise<ThreadMessageCategory | undefined> => {
	try {
		const addressId = deriveAddressId(accountConfigId, fromEmail);
		const address = await addressService.getAddress(accountConfigId, addressId);
		return address.flags?.category?.value;
	} catch (err) {
		if (!(err instanceof NotFoundError)) throw err;
		return undefined;
	}
};

/**
 * Header classification, with the sender's `Address.flags.category` override
 * (issue #299, RFC 039 Decision 3) substituted for the header-derived
 * category when one is set. Returns the subset of the Message update that
 * carries the derived fields; the caller folds it into a single UpdateItem
 * alongside `bodyStorageKey` (body-sync) or `classificationState` (the
 * classification backfill, issue #1197). Optional signals are omitted when
 * absent so we never overwrite an existing value with `undefined`.
 *
 * The override wins outright rather than blending with the heuristic — RFC
 * 039 Decision 3 treats a direct reclassification as final, the same as
 * `flags.blocked`/`vip` already override placement. Every caller gates on
 * `hasDecidedCategory` before this result reaches a write, so a message that
 * already carries a real category is never re-touched regardless of what
 * this returns.
 */
export const classifyParsedMessage = async (
	addressService: Pick<IAddressRepository, "getAddress">,
	accountConfigId: string,
	parsed: ParsedMail,
): Promise<UpdateMessageInput & { category: ThreadMessageCategory }> => {
	const headerCategory = classifyByHeaders(parsed);
	const authenticity = extractAuthenticity(parsed);
	const authResult = extractAuthResult(parsed);
	const providerSpam = extractProviderSpam(parsed);
	const hasListUnsubscribe = extractHasListUnsubscribe(parsed);

	// A passing SPF/DKIM/DMARC check proves the sending domain, not the
	// identity the message claims — on a shared-tenant host the verified
	// subdomain belongs to whoever signed up. These two comparisons say
	// whether the claim holds, and run only over mail the provider already
	// called spam.
	const senderMismatch =
		authenticity === null
			? {}
			: extractSenderMismatch(parsed, {
					fromDomain: authenticity.fromDomain,
					spamClassified: providerSpam?.classified === true,
					bulkSender: hasListUnsubscribe,
				});

	const fromEmail = extractPrimaryFromEmail(parsed);
	const categoryOverride = fromEmail
		? await resolveCategoryOverride(addressService, accountConfigId, fromEmail)
		: undefined;

	return {
		category: categoryOverride ?? headerCategory,
		hasListUnsubscribe,
		...(authenticity !== null
			? { authenticity: { ...authenticity, ...senderMismatch } }
			: {}),
		...(authResult !== null ? { authResult } : {}),
		...(providerSpam !== null ? { providerSpam } : {}),
	};
};
