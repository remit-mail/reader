import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { type FolderDescriptor, FolderNameList } from "./folder-name-list.js";
import type { FolderRole } from "./folder-name-row.js";

function seed(
	providerPath: string,
	detectedRole: FolderRole,
	overrides?: { role?: FolderRole; name?: string },
): FolderDescriptor {
	return {
		id: providerPath,
		providerPath,
		detectedRole,
		role: overrides?.role ?? detectedRole,
		name: overrides?.name ?? "",
	};
}

/** Owns override state, mirroring what a settings route would hold. */
function ListHarness({
	accountEmail,
	initial,
}: {
	accountEmail: string;
	initial: FolderDescriptor[];
}) {
	const [folders, setFolders] = useState(initial);
	const patch = (id: string, next: Partial<FolderDescriptor>) =>
		setFolders((rows) =>
			rows.map((row) => (row.id === id ? { ...row, ...next } : row)),
		);
	return (
		<div className="max-w-2xl p-8">
			<FolderNameList
				accountEmail={accountEmail}
				folders={folders}
				onCommit={(id, next) => patch(id, next)}
				onReset={(id) =>
					setFolders((rows) =>
						rows.map((row) =>
							row.id === id
								? { ...row, role: row.detectedRole, name: "" }
								: row,
						),
					)
				}
			/>
		</div>
	);
}

const meta: Meta<typeof ListHarness> = {
	title: "Settings/FolderNameList",
	component: ListHarness,
};
export default meta;

type Story = StoryObj<typeof ListHarness>;

/** The clean case: three recognized folders, no overrides. */
export const Recognized: Story = {
	args: {
		accountEmail: "you@example.com",
		initial: [
			seed("INBOX", "inbox"),
			seed("INBOX/Sent", "sent"),
			seed("INBOX/Spam", "junk"),
		],
	},
};

/**
 * A committed name override and a custom-folder promoted to a system role,
 * side by side — both show Reset. The promoted Newsletters folder (detected
 * custom, committed Archive) earns a row precisely because it now has a system
 * role.
 */
export const WithOverrides: Story = {
	args: {
		accountEmail: "you@example.com",
		initial: [
			seed("INBOX", "inbox", { name: "Primary" }),
			seed("INBOX/Newsletters", "custom", { role: "archive" }),
			seed("INBOX/Sent", "sent"),
		],
	},
};

/**
 * Real Hostnet account (440737+mvhenten@users.noreply.github.com). Several entries are
 * duplicates/legacy: Concepten ≈ Drafts, Sent Messages ≈ Sent, Deleted
 * Messages ≈ Trash. Detection maps them by role so the duplication is visible
 * here — exactly the mess the override UI exists to let a user clean up.
 *
 * INBOX/Nieuwsbrieven is in the input data with role "custom", so it is
 * filtered out — only the eight system folders render. That's the list doing
 * its job: this view is for canonical system folders only.
 */
export const FullHostnet: Story = {
	args: {
		accountEmail: "440737+mvhenten@users.noreply.github.com",
		initial: [
			seed("INBOX", "inbox"),
			seed("INBOX/Spam", "junk"),
			seed("INBOX/Sent", "sent"),
			seed("INBOX/Drafts", "drafts"),
			seed("INBOX/Archive", "archive"),
			seed("INBOX/Concepten", "drafts"),
			seed("INBOX/Nieuwsbrieven", "custom"),
			seed("INBOX/Sent Messages", "sent"),
			seed("INBOX/Deleted Messages", "trash"),
		],
	},
};
