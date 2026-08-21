import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { FolderRole } from "./folder-role.js";
import {
	type CandidateFolder,
	type RoleAppointment,
	RoleAppointmentList,
} from "./role-appointment-list.js";

/**
 * The user's real Hostnet account (440737+mvhenten@users.noreply.github.com). Every folder is nested
 * directly under the personal-namespace root `INBOX/`. The pair that breaks the
 * old per-folder model is here: the server flags `INBOX/Drafts` with `\Drafts`
 * but it is EMPTY — the mail lives in `INBOX/Concepten`. Same story for
 * `INBOX/Sent` vs `INBOX/Sent Messages`.
 *
 * NOTE: message counts are representative placeholders until live dev-stage
 * numbers are wired in.
 */
const HOSTNET_FOLDERS: readonly CandidateFolder[] = [
	{ mailboxId: "mb-inbox", providerPath: "INBOX", messageCount: 4821 },
	{
		mailboxId: "mb-archive",
		providerPath: "INBOX/Archive",
		messageCount: 19243,
	},
	{
		mailboxId: "mb-concepten",
		providerPath: "INBOX/Concepten",
		messageCount: 340,
	},
	{
		mailboxId: "mb-deleted",
		providerPath: "INBOX/Deleted Messages",
		messageCount: 512,
	},
	{ mailboxId: "mb-drafts", providerPath: "INBOX/Drafts", messageCount: 0 },
	{
		mailboxId: "mb-news",
		providerPath: "INBOX/Nieuwsbrieven",
		messageCount: 2870,
	},
	{ mailboxId: "mb-sent", providerPath: "INBOX/Sent", messageCount: 0 },
	{
		mailboxId: "mb-sent-messages",
		providerPath: "INBOX/Sent Messages",
		messageCount: 6105,
	},
	{ mailboxId: "mb-spam", providerPath: "INBOX/Spam", messageCount: 88 },
];

const appointed = (mailboxId: string): RoleAppointment => ({
	mailboxId,
	source: "Appointed",
});

/** Everything except the role each story is about, so one row carries the news. */
const SETTLED: Record<string, RoleAppointment> = {
	inbox: { mailboxId: "mb-inbox", source: "Reserved" },
	drafts: appointed("mb-concepten"),
	sent: appointed("mb-sent-messages"),
	archive: appointed("mb-archive"),
	junk: appointed("mb-spam"),
	trash: appointed("mb-deleted"),
};

function Harness({
	folders,
	initial,
}: {
	folders: readonly CandidateFolder[];
	initial: Record<string, RoleAppointment>;
}) {
	const [appointments, setAppointments] = useState(initial);
	const [displayNames, setDisplayNames] = useState<Record<string, string>>({});

	const handleAppoint = (role: FolderRole, mailboxId: string | null) => {
		setAppointments((prev) => {
			const next: Record<string, RoleAppointment> = {
				...prev,
				[role]: mailboxId
					? { mailboxId, source: "Appointed" }
					: { mailboxId: null, source: "None" },
			};
			// Exclusivity: appointing a folder to one role clears it from any other.
			if (mailboxId) {
				for (const other of Object.keys(next)) {
					if (other === role) continue;
					if (next[other]?.mailboxId !== mailboxId) continue;
					next[other] = { mailboxId: null, source: "None" };
				}
			}
			return next;
		});
	};

	const handleRename = (mailboxId: string, name: string) =>
		setDisplayNames((prev) => ({ ...prev, [mailboxId]: name.trim() }));

	return (
		<div className="max-w-3xl p-8">
			<RoleAppointmentList
				accountEmail="440737+mvhenten@users.noreply.github.com"
				folders={folders}
				appointments={appointments}
				displayNames={displayNames}
				onAppoint={handleAppoint}
				onRename={handleRename}
			/>
		</div>
	);
}

const meta: Meta<typeof Harness> = {
	title: "Settings/RoleAppointmentList",
	component: Harness,
};
export default meta;

type Story = StoryObj<typeof Harness>;

/**
 * The intended end state: each role points at the folder that holds the mail —
 * Drafts → Concepten · 340, not the empty `INBOX/Drafts`; Sent → Sent Messages.
 * The empty look-alikes drop to "Other folders".
 */
export const Hostnet: Story = {
	args: { folders: HOSTNET_FOLDERS, initial: SETTLED },
};

/**
 * Flag-first proposal before the user corrects it: detection appointed the
 * `\Drafts`-flagged but empty `INBOX/Drafts` (0) and the empty `INBOX/Sent`.
 * The picker counts reveal the real folders so the user can re-appoint.
 */
export const ProposedDefaults: Story = {
	args: {
		folders: HOSTNET_FOLDERS,
		initial: {
			...SETTLED,
			drafts: { mailboxId: "mb-drafts", source: "Flagged" },
			sent: { mailboxId: "mb-sent", source: "Flagged" },
		},
	},
};

/** `Appointed` — a person decided, and the row says so. */
export const AppointedSource: Story = {
	name: "appointed",
	args: { folders: HOSTNET_FOLDERS, initial: SETTLED },
};

/** `Flagged` — the mail server's own SPECIAL-USE flag, not a guess. */
export const FlaggedSource: Story = {
	name: "flagged",
	args: {
		folders: HOSTNET_FOLDERS,
		initial: {
			...SETTLED,
			trash: { mailboxId: "mb-deleted", source: "Flagged" },
		},
	},
};

/** `Reserved` — INBOX is the one role the protocol names for us. */
export const ReservedSource: Story = {
	name: "reserved",
	args: {
		folders: HOSTNET_FOLDERS,
		initial: { ...SETTLED, inbox: { mailboxId: "mb-inbox", source: "Reserved" } },
	},
};

/** `Proposed` — a name matched. Nobody confirmed it, and the row does not pretend otherwise. */
export const ProposedSource: Story = {
	name: "proposed",
	args: {
		folders: HOSTNET_FOLDERS,
		initial: {
			...SETTLED,
			trash: { mailboxId: "mb-deleted", source: "Proposed" },
		},
	},
};

/**
 * `Stale` — the folder the user chose is gone from the mail server. The one row
 * representing a broken decision, so it is a callout with its repair rather
 * than a subtitle. Deleting mail is stopped until Trash is repaired.
 */
export const StaleSource: Story = {
	name: "stale",
	args: {
		folders: HOSTNET_FOLDERS,
		initial: {
			...SETTLED,
			trash: {
				mailboxId: null,
				source: "Stale",
				staleFolderPath: "INBOX/Prullenbak",
			},
		},
	},
};

/** `None` — a decision waiting to be made. No icon, no danger colour. */
export const NoneSource: Story = {
	name: "none",
	args: {
		folders: HOSTNET_FOLDERS,
		initial: {
			...SETTLED,
			trash: { mailboxId: null, source: "None" },
			archive: { mailboxId: null, source: "None" },
		},
	},
};
