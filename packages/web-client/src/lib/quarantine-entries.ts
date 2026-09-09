import type { RemitImapQuarantineResponse } from "@remit/api-http-client/types.gen.ts";
import type { QuarantineEntry } from "@remit/ui";
import { CANONICAL_TO_NAV_ROLE } from "./folder-roles";

/**
 * The wire record carries `accountConfigId`, `createdAt` and `updatedAt`, which
 * the settings surface has no use for, and spells the folder role in the
 * canonical PascalCase the API uses everywhere. Both differences are resolved
 * here rather than by widening the kit's entry type.
 *
 * The record carries no hierarchy delimiter either, so the caller joins the
 * mailbox id against the account's own mailbox list and hands the delimiter in
 * — the row shows a folder name, and a path cannot be cut into one without it.
 * An empty delimiter means no account lists that mailbox, and the row keeps its
 * whole path rather than being cut on a guess.
 */
export function toQuarantineEntry(
	wire: RemitImapQuarantineResponse,
	mailboxDelimiter: string,
): QuarantineEntry {
	return {
		quarantineId: wire.quarantineId,
		accountId: wire.accountId,
		mailboxId: wire.mailboxId,
		uidValidity: wire.uidValidity,
		uid: wire.uid,
		mailboxRole: wire.mailboxRole
			? CANONICAL_TO_NAV_ROLE[wire.mailboxRole]
			: undefined,
		mailboxPath: wire.mailboxPath,
		mailboxDelimiter,
		failureStage: wire.failureStage,
		failureCode: wire.failureCode,
		failureMessage: wire.failureMessage,
		failurePartPath: wire.failurePartPath,
		quarantinedAt: wire.quarantinedAt,
		attempts: wire.attempts,
		sizeBytes: wire.sizeBytes,
		contentType: wire.contentType,
		transferEncoding: wire.transferEncoding,
		charset: wire.charset,
		structure: wire.structure,
		messageIdHash: wire.messageIdHash,
		workerVersion: wire.workerVersion,
	};
}
