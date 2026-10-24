import type {
	CreateMailboxInput,
	MailboxResponse,
	RenameMailboxInput,
} from "@remit/api-openapi-types";
import type { IAccountSettingRepository, MailboxItem } from "@remit/data-ports";
import { isReservedFolderName } from "@remit/data-ports/folder-role";
import { mailboxLeafName } from "@remit/data-ports/mailbox-name";
import { MailboxSyncStatus } from "@remit/domain-enums";
import type { AuthenticatedUser } from "../auth.js";
import {
	applyMailboxOverrideChanges,
	loadMailboxOverrides,
	type MailboxOverrides,
} from "../handlers/account-overrides.js";
import type { RemitClient } from "./data-client.js";
import { accountOwnershipRefusal, mailboxInAccountRefusal } from "./guards.js";
import { invalid, type Outcome, ok, type Refusal, refuse } from "./outcome.js";

/**
 * The mute flag and the display-name override are user preferences that live
 * in per-mailbox AccountSetting rows (RFC 032), not on the Mailbox entity.
 * Pick only those keys from a PATCH body: each follows the same `null` → remove,
 * value → set, absent/undefined → no-op semantics as UpdateAddressFlagsInput.
 * The canonical role a folder fills is appointed separately — see
 * FolderRoleOperations.appointFolderRole (RFC 032 exclusive-folder-appointment).
 */
export const pickMailboxOverrideChanges = (
	body: RenameMailboxInput,
): {
	displayNameOverride?: string | null;
	muted?: RenameMailboxInput["muted"];
} => {
	const changes: {
		displayNameOverride?: string | null;
		muted?: RenameMailboxInput["muted"];
	} = {};
	if (Object.hasOwn(body, "displayNameOverride")) {
		changes.displayNameOverride = body.displayNameOverride;
	}
	if (Object.hasOwn(body, "muted")) {
		changes.muted = body.muted;
	}
	return changes;
};

/**
 * Minimal client surface needed to apply a mailbox PATCH. Structurally
 * satisfied by RemitClient; narrowed so tests can stub it.
 */
export interface MailboxPatchClient {
	mailbox: {
		get(accountId: string, mailboxId: string): Promise<MailboxItem>;
		listAllByAccount(accountId: string): Promise<MailboxItem[]>;
	};
	mailboxQueue: {
		renameMailbox(
			mailboxId: string,
			newPath: string,
			accountId: string,
		): Promise<MailboxItem>;
		dismissMailboxIntent(
			mailboxId: string,
			accountId: string,
		): Promise<MailboxItem>;
	};
	accountSetting: Pick<IAccountSettingRepository, "get" | "upsert" | "delete">;
}

/**
 * Refuse a rename that no retry of the same request could ever satisfy (D4).
 *
 * `INBOX` is refused at both ends: renaming it moves its mail to the new name
 * and leaves an empty INBOX behind, and renaming anything *to* it collides with
 * the one name RFC 3501 reserves (D5).
 *
 * A reserved leaf name is refused for a different reason. The mailbox sweep
 * reads a folder whose leaf name is a role's conventional name but which lacks
 * the server's flag as a duplicate, and deletes its row — under D8, with the
 * folder's mail — as soon as another folder holds the flag. A rename to such a
 * name settles `synced` and is then reaped. Refusing at the API is the same
 * class of check as the rest of D4 and does not require teaching that heuristic
 * about renames.
 */
const renameTargetRefusal = async (
	client: Pick<MailboxPatchClient, "mailbox">,
	accountId: string,
	before: MailboxItem,
	target: string,
): Promise<Refusal | undefined> => {
	if (before.fullPath.toUpperCase() === "INBOX") {
		return invalid("The inbox can't be renamed.");
	}
	if (target.trim().length === 0) {
		return invalid("A folder needs a name.");
	}
	if (target.toUpperCase() === "INBOX") {
		return invalid("“INBOX” is reserved for the inbox.");
	}

	const leaf = mailboxLeafName({
		fullPath: target,
		hierarchyDelimiter: before.hierarchyDelimiter,
	});
	if (isReservedFolderName(leaf)) {
		return invalid(
			`“${leaf}” is reserved for a system folder. Pick another name.`,
		);
	}

	// A path a rename is on its way to is as taken as one a folder already sits
	// at (D2). Reading `fullPath` alone accepts a second rename onto a target
	// another is already recorded for: both settle, both write the same path,
	// and the sweep then reaps one row — with its mail — and inserts a duplicate
	// for the survivor's path. The account's folders are few and the sweep
	// already reads them all, so one pass answers both questions.
	const folders = await client.mailbox.listAllByAccount(accountId);
	for (const folder of folders) {
		if (folder.mailboxId === before.mailboxId) continue;
		if (folder.fullPath === target) {
			return invalid(`A folder named “${target}” is already there.`);
		}
		// `pending` only. A failed rename keeps its target so the client can name
		// what it was aiming at and offer a retry (T6), and nothing clears it
		// until the user retries or dismisses — so honouring a `failed` row's
		// claim would tell everyone else the path is taken by a rename that is
		// not happening, with no way to find that out and nothing to wait for.
		if (
			folder.syncStatus === MailboxSyncStatus.pending &&
			folder.pendingPath === target
		) {
			return invalid(
				`“${folder.fullPath}” is already being renamed to “${target}”.`,
			);
		}
	}
	return undefined;
};

/**
 * Apply a mailbox PATCH body: override changes first (mute flag + display-name/
 * role overrides — written to per-mailbox AccountSetting rows, no IMAP
 * machinery), then rename — which triggers the IMAP rename machinery
 * (the recorded subtree intent + MAILBOX_RENAME event) — only when `fullPath`
 * is present. An override-only PATCH therefore never calls
 * `mailboxQueue.renameMailbox`.
 *
 * A `fullPath` equal to the row's confirmed one is not a rename: it is the
 * dismissal of a failed intent (T10, T11), which is how a user keeps the name
 * the folder already has without new API surface. It is checked first, because
 * from `failed` it is the one route out that enqueues nothing.
 */
export const applyMailboxPatch = async (
	client: MailboxPatchClient,
	accountConfigId: string,
	mailboxId: string,
	accountId: string,
	body: RenameMailboxInput,
): Promise<Outcome<MailboxItem>> => {
	const { fullPath } = body;

	// --- Override settings (mute flag + display-name/role overrides) ---
	// Written to per-mailbox AccountSetting rows (RFC 032) with the same
	// null→remove semantics as UpdateAddressFlagsInput. Applied before (and
	// independent of) any rename so an override-only PATCH never touches the
	// row's mutation state.
	const changes = pickMailboxOverrideChanges(body);
	if (Object.keys(changes).length > 0) {
		await applyMailboxOverrideChanges(
			client.accountSetting,
			accountConfigId,
			mailboxId,
			changes,
		);
	}

	// --- Rename (IMAP machinery) ---
	// Only triggered when fullPath is present.
	if (!fullPath) {
		return ok(await client.mailbox.get(accountId, mailboxId));
	}

	const before = await client.mailbox.get(accountId, mailboxId);
	if (fullPath === before.fullPath) {
		return ok(
			await client.mailboxQueue.dismissMailboxIntent(mailboxId, accountId),
		);
	}

	const refusal = await renameTargetRefusal(
		client,
		accountId,
		before,
		fullPath,
	);
	if (refusal) return refuse(refusal);

	// The row keeps the path the server holds until the rename settles (D2), so
	// nothing that names a folder by path moves here — the appointment labels
	// recorded beside each role (#887) included. They move with the settle.
	return ok(
		await client.mailboxQueue.renameMailbox(mailboxId, fullPath, accountId),
	);
};

export const toMailboxResponse = (
	mailbox: MailboxItem,
	overrides: MailboxOverrides = {},
): MailboxResponse => ({
	mailboxId: mailbox.mailboxId,
	accountId: mailbox.accountId,
	namespaceType: mailbox.namespaceType,
	namespacePrefix: mailbox.namespacePrefix,
	hierarchyDelimiter: mailbox.hierarchyDelimiter,
	fullPath: mailbox.fullPath,
	messageCount: mailbox.messageCount,
	unseenCount: mailbox.unseenCount,
	deletedCount: mailbox.deletedCount,
	specialUse: mailbox.specialUse ? Array.from(mailbox.specialUse) : undefined,
	lastSyncUid: mailbox.lastSyncUid,
	highWaterMarkUid: mailbox.highWaterMarkUid,
	lastMessageSyncAt: mailbox.lastMessageSyncAt,
	syncStatus: mailbox.syncStatus,
	// The row is the only thing that knows what a rename is aiming at, and
	// `fullPath` stays the confirmed one throughout (D2), so without this a
	// client cannot tell a create in flight from a rename in flight, name the
	// target of a failed rename, or offer the right retry.
	pendingPath: mailbox.pendingPath,
	syncFailureReason: mailbox.syncFailureReason,
	muted: overrides.muted,
	displayNameOverride: overrides.displayNameOverride,
	createdAt: mailbox.createdAt,
	updatedAt: mailbox.updatedAt,
});

/**
 * Records a folder create as a pending intent; the mail server confirms it
 * later (docs/architecture/imap-mutations.md). The response is the pending row.
 */
export const createMailbox = async (
	client: RemitClient,
	user: AuthenticatedUser,
	input: { accountId: string; mailbox: CreateMailboxInput },
): Promise<Outcome<MailboxResponse>> => {
	const { accountId } = input;
	const { namespaceType, fullPath } = input.mailbox;

	const account = await client.account.get(accountId);
	const notOwned = accountOwnershipRefusal(
		account,
		user.accountConfigId,
		"act",
	);
	if (notOwned) return refuse(notOwned);

	const created = await client.mailboxQueue.createMailbox(
		{
			accountId,
			namespaceType,
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath,
			uidValidity: 0,
			uidNext: 1,
			highestModseq: "0",
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: 0,
		},
		accountId,
		true,
	);
	if (created.outcome === "PathTaken") {
		return refuse(invalid(`A folder named “${fullPath}” is already there.`));
	}

	return ok(toMailboxResponse(created.mailbox));
};

/**
 * Renames or moves a folder (a new `fullPath`), and sets its per-user
 * overrides. The rename is recorded as a pending intent the mail server
 * settles later; `fullPath` stays the confirmed path until then (D2).
 */
export const renameMailbox = async (
	client: RemitClient,
	user: AuthenticatedUser,
	input: { accountId: string; mailboxId: string; patch: RenameMailboxInput },
): Promise<Outcome<MailboxResponse>> => {
	const { accountId, mailboxId } = input;
	const { accountConfigId } = user;

	const account = await client.account.get(accountId);
	const notOwned = accountOwnershipRefusal(account, accountConfigId, "act");
	if (notOwned) return refuse(notOwned);

	const existing = await client.mailbox.get(accountId, mailboxId);
	const elsewhere = mailboxInAccountRefusal(existing, accountId, "act");
	if (elsewhere) return refuse(elsewhere);

	const mailbox = await applyMailboxPatch(
		client,
		accountConfigId,
		mailboxId,
		accountId,
		input.patch,
	);
	if (!mailbox.ok) return mailbox;
	const overrides = await loadMailboxOverrides(
		client.accountSetting,
		accountConfigId,
		mailboxId,
	);
	return ok(toMailboxResponse(mailbox.value, overrides));
};
