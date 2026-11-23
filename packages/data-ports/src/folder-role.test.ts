import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CanonicalMailboxRole,
	FolderAppointmentSource,
	MailboxSpecialUse,
	MailboxSyncStatus,
} from "@remit/domain-enums";
import {
	composeFolderRoleAppointmentLabelName,
	composeFolderRoleAppointmentName,
	isReservedFolderName,
	meetsTrashAssurance,
	parseFolderRoleAppointmentLabelName,
	parseFolderRoleAppointmentName,
	type RoleMailboxCandidate,
	resolveConfirmedMailboxForRole,
	resolveMailboxForRole,
	resolveRoleForAccount,
	trashSourceMeetsAssurance,
} from "./folder-role.js";

const mailbox = (
	mailboxId: string,
	fullPath: string,
	specialUse: readonly string[] = [],
	hierarchyDelimiter = "/",
): RoleMailboxCandidate => ({
	mailboxId,
	fullPath,
	hierarchyDelimiter,
	specialUse,
});

describe("resolveMailboxForRole precedence", () => {
	const mailboxes = [
		mailbox("mb-inbox", "INBOX"),
		mailbox("mb-spam", "INBOX/Spam"),
		mailbox("mb-junk", "Junk", [MailboxSpecialUse.Junk]),
		mailbox("mb-project", "INBOX/Project X"),
	];

	it("puts the user's appointment above both the flag and the name", () => {
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Junk, mailboxes, "mb-project")
				?.mailboxId,
			"mb-project",
		);
	});

	it("takes the server's SPECIAL-USE flag when nothing is appointed", () => {
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Junk, mailboxes)?.mailboxId,
			"mb-junk",
		);
	});

	it("falls back to the name only when no flag is present", () => {
		const unflagged = mailboxes.filter((m) => m.mailboxId !== "mb-junk");
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Junk, unflagged)?.mailboxId,
			"mb-spam",
		);
	});

	it("reads the leaf against the mailbox's own delimiter, not a hardcoded slash", () => {
		const dotted = [
			mailbox("mb-inbox", "INBOX", [], "."),
			mailbox("mb-trash", "INBOX.Deleted Items", [], "."),
		];
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, dotted)?.mailboxId,
			"mb-trash",
		);
	});

	it("matches the reserved INBOX name for Inbox", () => {
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Inbox, mailboxes)?.mailboxId,
			"mb-inbox",
		);
	});

	it("returns null rather than guessing when nothing matches", () => {
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Archive, mailboxes),
			null,
		);
	});

	it("re-proposes when the appointment names a mailbox that is gone", () => {
		assert.equal(
			resolveMailboxForRole(
				CanonicalMailboxRole.Junk,
				mailboxes,
				"mb-deleted-last-week",
			)?.mailboxId,
			"mb-junk",
		);
	});
});

describe("resolveMailboxForRole on [Gmail]/Trash beside a top-level Bin", () => {
	// #837: joining Trash to the leaf-name resolver made depth outrank the name,
	// so a top-level `Bin` beat `[Gmail]/Trash` and deletes landed in the wrong
	// folder. `bin` is no longer a hint — Gmail flags both \Trash — so the name
	// rule reaches `[Gmail]/Trash` and nothing reaches `Bin`.
	const mailboxes = [
		mailbox("mb-inbox", "INBOX"),
		mailbox("mb-bin", "Bin"),
		mailbox("mb-gmail-trash", "[Gmail]/Trash"),
	];

	it("proposes [Gmail]/Trash, never the folder called Bin", () => {
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, mailboxes)?.mailboxId,
			"mb-gmail-trash",
		);
	});

	it("resolves to whichever folder the user appointed", () => {
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, mailboxes, "mb-bin")
				?.mailboxId,
			"mb-bin",
		);
	});

	it("still takes the SPECIAL-USE flag over the name when nothing is appointed", () => {
		const flagged = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-bin", "Bin"),
			mailbox("mb-gmail-trash", "[Gmail]/Trash", [MailboxSpecialUse.Trash]),
		];
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, flagged)?.mailboxId,
			"mb-gmail-trash",
		);
	});
});

describe("resolveConfirmedMailboxForRole", () => {
	// What Empty Trash resolves through: an expunge may only touch a folder
	// somebody actually designated (audit #841).
	const mailboxes = [
		mailbox("mb-inbox", "INBOX"),
		mailbox("mb-deleted", "Deleted"),
		mailbox("mb-gmail-trash", "[Gmail]/Trash"),
	];

	it("refuses a name match nested outside INBOX", () => {
		assert.equal(
			resolveConfirmedMailboxForRole(CanonicalMailboxRole.Trash, mailboxes),
			null,
		);
	});

	it("accepts a unique detected name", () => {
		const detected = mailbox("mb-trash", "INBOX/Deleted Messages");
		assert.equal(
			resolveConfirmedMailboxForRole(CanonicalMailboxRole.Trash, [detected]),
			detected,
		);
	});

	it("takes the appointment over the folder the name rule would have picked", () => {
		assert.equal(
			resolveConfirmedMailboxForRole(
				CanonicalMailboxRole.Trash,
				mailboxes,
				"mb-gmail-trash",
			)?.mailboxId,
			"mb-gmail-trash",
		);
	});

	it("takes the server flag when nothing is appointed", () => {
		const flagged = [
			mailbox("mb-deleted", "Deleted"),
			mailbox("mb-trash", "[Gmail]/Trash", [MailboxSpecialUse.Trash]),
		];
		assert.equal(
			resolveConfirmedMailboxForRole(CanonicalMailboxRole.Trash, flagged)
				?.mailboxId,
			"mb-trash",
		);
	});
});

describe("resolveRoleForAccount", () => {
	it("resolves an appointment naming a mailbox whose last sync failed", () => {
		// `failed` means the folder exists at `fullPath` and the last rename or
		// delete intent did not land (folder-rename-and-delete.md D7), so the row
		// names a path the server really holds.
		const failed: RoleMailboxCandidate & { syncStatus: string } = {
			...mailbox("mb-trash", "INBOX/Prullenbak"),
			syncStatus: MailboxSyncStatus.failed,
		};
		assert.deepEqual(
			resolveRoleForAccount(
				CanonicalMailboxRole.Trash,
				[mailbox("mb-inbox", "INBOX"), failed],
				"mb-trash",
			),
			{ kind: "appointed", mailbox: failed },
		);
	});

	it("keeps an ambiguous Trash proposed, which is not enough to empty it", () => {
		// #887 Done item 1: the name is a guess. It files a delete somewhere
		// retrievable; it never authorises an expunge.
		const mailboxes = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-werk", "Werk"),
			mailbox("mb-trash", "Trash"),
			mailbox("mb-deleted-items", "Deleted Items"),
		];
		const resolution = resolveRoleForAccount(
			CanonicalMailboxRole.Trash,
			mailboxes,
		);
		assert.deepEqual(resolution, {
			kind: "proposed",
			mailbox: mailboxes[2],
		});
		assert.equal(meetsTrashAssurance(resolution, "confirmed"), false);
		assert.equal(meetsTrashAssurance(resolution, "resolved"), true);
	});

	it("names the appointment that went stale, and what took its place", () => {
		const mailboxes = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-trash", "[Gmail]/Trash", [MailboxSpecialUse.Trash]),
		];
		const resolution = resolveRoleForAccount(
			CanonicalMailboxRole.Trash,
			mailboxes,
			"mb-rubbish-deleted-by-apple-mail",
		);
		assert.deepEqual(resolution, {
			kind: "appointment_stale",
			appointedMailboxId: "mb-rubbish-deleted-by-apple-mail",
			fallback: { kind: "flagged", mailbox: mailboxes[1] },
		});
		assert.equal(meetsTrashAssurance(resolution, "confirmed"), false);
		assert.equal(meetsTrashAssurance(resolution, "resolved"), false);
	});

	it("tags the appointment the user made and the flag the server set apart", () => {
		const mailboxes = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-trash", "[Gmail]/Trash", [MailboxSpecialUse.Trash]),
		];
		assert.equal(
			resolveRoleForAccount(CanonicalMailboxRole.Trash, mailboxes).kind,
			"flagged",
		);
		assert.equal(
			resolveRoleForAccount(CanonicalMailboxRole.Trash, mailboxes, "mb-inbox")
				.kind,
			"appointed",
		);
		assert.equal(
			resolveRoleForAccount(CanonicalMailboxRole.Inbox, mailboxes).kind,
			"reserved",
		);
	});
});

describe("the adapters over resolveRoleForAccount", () => {
	const mailboxes = [
		mailbox("mb-inbox", "INBOX"),
		mailbox("mb-trash", "[Gmail]/Trash", [MailboxSpecialUse.Trash]),
	];

	it("withholds a stale appointment's fallback from the confirmed answer only", () => {
		// A vanished appointment is not confirmation of anything, so the expunge
		// gate sees nothing. Filing mail still works: the fallback is a fine place
		// to put a message the user can move back.
		assert.equal(
			resolveConfirmedMailboxForRole(
				CanonicalMailboxRole.Trash,
				mailboxes,
				"mb-gone",
			),
			null,
		);
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, mailboxes, "mb-gone")
				?.mailboxId,
			"mb-trash",
		);
	});

	it("keeps a stale appointment on the flag, never on a folder named like one", () => {
		// The confirmed adapter is not built on top of the other one: were it,
		// null-on-stale would drop the seven non-Trash roles past their
		// SPECIAL-USE flag and into the name hint, and a folder somebody called
		// "Sent" would start collecting this account's sent mail.
		const sent = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-sent-copy", "Sent"),
			mailbox("mb-sent", "[Gmail]/Sent Mail", [MailboxSpecialUse.Sent]),
		];
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Sent, sent, "mb-gone")
				?.mailboxId,
			"mb-sent",
		);
	});

	it("keeps the name guess out of the confirmed answer", () => {
		const unflagged = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-bak", "Trash"),
			mailbox("mb-other-trash", "Deleted Items"),
		];
		assert.equal(
			resolveConfirmedMailboxForRole(CanonicalMailboxRole.Trash, unflagged),
			null,
		);
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, unflagged)?.mailboxId,
			"mb-bak",
		);
	});
});

describe("trashSourceMeetsAssurance", () => {
	it("confirms appointments, flags and unambiguous detection", () => {
		// The set a client may word an expunge from. `Reserved` reads as
		// designated and is not: it is the INBOX name rule, which nobody chose.
		const confirmed = Object.values(FolderAppointmentSource).filter((source) =>
			trashSourceMeetsAssurance(source, "confirmed"),
		);
		assert.deepEqual(confirmed, [
			FolderAppointmentSource.Appointed,
			FolderAppointmentSource.Flagged,
			FolderAppointmentSource.Detected,
		]);
	});

	it("adds the name guess at `resolved`, where a wrong guess only misfiles", () => {
		const resolved = Object.values(FolderAppointmentSource).filter((source) =>
			trashSourceMeetsAssurance(source, "resolved"),
		);
		assert.deepEqual(resolved, [
			FolderAppointmentSource.Appointed,
			FolderAppointmentSource.Flagged,
			FolderAppointmentSource.Detected,
			FolderAppointmentSource.Proposed,
		]);
	});
});

describe("the appointment name and its label sibling", () => {
	it("never lets the label row parse as an appointment", () => {
		// The label is display only. If the appointment parser matched it, a path
		// string would be read back as a mailboxId and resolution would follow it.
		const label = composeFolderRoleAppointmentLabelName(
			"acc-1",
			CanonicalMailboxRole.Trash,
		);
		assert.equal(parseFolderRoleAppointmentName(label), undefined);
		assert.deepEqual(parseFolderRoleAppointmentLabelName(label), {
			accountId: "acc-1",
			role: CanonicalMailboxRole.Trash,
		});
	});

	it("never lets an appointment row parse as a label", () => {
		const appointment = composeFolderRoleAppointmentName(
			"acc-1",
			CanonicalMailboxRole.Trash,
		);
		assert.equal(parseFolderRoleAppointmentLabelName(appointment), undefined);
		assert.deepEqual(parseFolderRoleAppointmentName(appointment), {
			accountId: "acc-1",
			role: CanonicalMailboxRole.Trash,
		});
	});
});

describe("isReservedFolderName", () => {
	for (const name of [
		"archive",
		"Archive",
		"ARCHIVES",
		"trash",
		"Deleted Items",
		"drafts",
		"Sent Mail",
		"junk",
		"Spam",
		"All Mail",
	]) {
		it(`reserves "${name}"`, () => {
			assert.equal(isReservedFolderName(name), true);
		});
	}

	/**
	 * #843 dropped a bare "Deleted" and "Bin" from the Trash hints precisely
	 * because they are ordinary folder names a user keeps mail in. Reserving
	 * them here would protect names that do not identify a role.
	 */
	for (const name of ["Deleted", "Bin", "Receipts", "Work", "Inbox 2024"]) {
		it(`leaves "${name}" alone`, () => {
			assert.equal(isReservedFolderName(name), false);
		});
	}
});

// These are account-local LIST projections, with only the server's Junk flag.
describe("name detection with real account folder lists (#1693)", () => {
	const folders = (paths: string[]) =>
		paths.map((path) =>
			mailbox(
				path,
				path,
				path === "INBOX/Spam" ? [MailboxSpecialUse.Junk] : [],
			),
		);
	const matthijs = folders([
		"INBOX/Sent",
		"INBOX/Sent Messages",
		"INBOX/Drafts",
		"INBOX/Concepten",
		"INBOX/Archive",
		"INBOX/Spam",
		"INBOX/Deleted Messages",
	]);
	const info = folders([
		"INBOX/Prullenbak",
		"INBOX/Trash",
		"INBOX/Deleted Messages",
		"INBOX/Spam",
	]);

	for (const [role, kind, path] of [
		[CanonicalMailboxRole.Trash, "detected", "INBOX/Deleted Messages"],
		[CanonicalMailboxRole.Archive, "detected", "INBOX/Archive"],
		[CanonicalMailboxRole.Junk, "flagged", "INBOX/Spam"],
		[CanonicalMailboxRole.Sent, "proposed", "INBOX/Sent"],
		[CanonicalMailboxRole.Drafts, "proposed", "INBOX/Drafts"],
	] as const) {
		it(`matthijs@: ${role} is ${kind}`, () => {
			assert.deepEqual(resolveRoleForAccount(role, matthijs), {
				kind,
				mailbox: matthijs.find((m) => m.fullPath === path),
			});
		});
	}

	it("keeps the three info@ candidates ambiguous and independent of matthijs@", () => {
		assert.deepEqual(resolveRoleForAccount(CanonicalMailboxRole.Trash, info), {
			kind: "proposed",
			mailbox: info[1],
		});
		assert.deepEqual(resolveRoleForAccount(CanonicalMailboxRole.Junk, info), {
			kind: "flagged",
			mailbox: info[3],
		});
		assert.deepEqual(
			resolveRoleForAccount(CanonicalMailboxRole.Trash, matthijs),
			{
				kind: "detected",
				mailbox: matthijs[6],
			},
		);
	});

	for (const path of [
		"Trash",
		"INBOX/Prullenbak",
		"Verwijderde items",
		"Papierkorb",
		"Corbeille",
		"Papelera",
		"Cestino",
		"Lixeira",
		"INBOX/VERWIJDERDE BERICHTEN",
	]) {
		it(`detects the unique Trash ${path}`, () => {
			const candidates = folders([path]);
			const resolution = resolveRoleForAccount(
				CanonicalMailboxRole.Trash,
				candidates,
			);
			assert.deepEqual(resolution, {
				kind: "detected",
				mailbox: candidates[0],
			});
			assert.equal(meetsTrashAssurance(resolution, "confirmed"), true);
		});
	}

	for (const [role, path] of [
		[CanonicalMailboxRole.Trash, "INBOX/E\u0301LE\u0301MENTS SUPPRIME\u0301S"],
		[CanonicalMailboxRole.Sent, "Envoyés"],
		[CanonicalMailboxRole.Drafts, "INBOX/Entwürfe"],
		[CanonicalMailboxRole.Archive, "Archief"],
	] as const) {
		it(`detects the normalized ${role} name ${path}`, () => {
			const candidates = folders([path]);
			assert.deepEqual(resolveRoleForAccount(role, candidates), {
				kind: "detected",
				mailbox: candidates[0],
			});
		});
	}

	it("uses the server's delimiter for detected INBOX and flat names", () => {
		for (const [path, delimiter] of [
			["inbox.Prullenbak", "."],
			["Trash", ""],
		]) {
			const candidate = mailbox("trash", path, [], delimiter);
			assert.deepEqual(
				resolveRoleForAccount(CanonicalMailboxRole.Trash, [candidate]),
				{
					kind: "detected",
					mailbox: candidate,
				},
			);
		}
	});

	it("counts canonically equivalent names as separate mailbox candidates", () => {
		const candidates = folders([
			"Éléments supprimés",
			"INBOX/E\u0301le\u0301ments supprime\u0301s",
		]);
		assert.deepEqual(
			resolveRoleForAccount(CanonicalMailboxRole.Trash, candidates),
			{
				kind: "proposed",
				mailbox: candidates[0],
			},
		);
	});

	it("never detects a nested name, a partial match, bare Deleted/Bin or All Mail as Archive", () => {
		const nested = folders(["Projects/Trash"]);
		assert.deepEqual(
			resolveRoleForAccount(CanonicalMailboxRole.Trash, nested),
			{
				kind: "proposed",
				mailbox: nested[0],
			},
		);
		assert.deepEqual(
			resolveRoleForAccount(
				CanonicalMailboxRole.Trash,
				folders(["Deleted", "Bin", "My Trash", "Trash 2025"]),
			),
			{ kind: "none" },
		);
		assert.deepEqual(
			resolveRoleForAccount(
				CanonicalMailboxRole.Archive,
				folders(["All Mail"]),
			),
			{ kind: "none" },
		);
	});

	it("withholds a stale appointment even when its fallback is detected", () => {
		const resolution = resolveRoleForAccount(
			CanonicalMailboxRole.Trash,
			matthijs,
			"gone",
		);
		assert.equal(meetsTrashAssurance(resolution, "confirmed"), false);
		assert.equal(meetsTrashAssurance(resolution, "resolved"), false);
	});
});
