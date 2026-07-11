import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { FolderRole } from "./folder-role.js";
import {
	type CandidateFolder,
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

function Harness({
	folders,
	initial,
}: {
	folders: readonly CandidateFolder[];
	initial: Record<string, string | null>;
}) {
	const [appointments, setAppointments] = useState(initial);
	const [displayNames, setDisplayNames] = useState<Record<string, string>>({});

	const handleAppoint = (role: FolderRole, mailboxId: string | null) => {
		setAppointments((prev) => {
			const next: Record<string, string | null> = {
				...prev,
				[role]: mailboxId,
			};
			// Exclusivity: appointing a folder to one role clears it from any other.
			if (mailboxId) {
				for (const r of Object.keys(next)) {
					if (r !== role && next[r] === mailboxId) next[r] = null;
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
	args: {
		folders: HOSTNET_FOLDERS,
		initial: {
			inbox: "mb-inbox",
			drafts: "mb-concepten",
			sent: "mb-sent-messages",
			archive: "mb-archive",
			junk: "mb-spam",
			trash: "mb-deleted",
		},
	},
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
			inbox: "mb-inbox",
			drafts: "mb-drafts",
			sent: "mb-sent",
			archive: "mb-archive",
			junk: "mb-spam",
			trash: "mb-deleted",
		},
	},
};
