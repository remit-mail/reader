import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FolderNameRow, type FolderRole } from "./folder-name-row.js";

/**
 * Interactive harness: owns the *committed* state a real settings screen would.
 * The row holds its own draft; committing (✔️) or resetting (↺) flows back here.
 */
function RowHarness({
	providerPath,
	detectedRole,
	committedRole,
	committedName = "",
	draftRole,
	draftName,
}: {
	providerPath: string;
	detectedRole: FolderRole;
	committedRole?: FolderRole;
	committedName?: string;
	draftRole?: FolderRole;
	draftName?: string;
}) {
	const [role, setRole] = useState<FolderRole>(committedRole ?? detectedRole);
	const [name, setName] = useState(committedName);
	const defaultDraft =
		draftRole !== undefined || draftName !== undefined
			? { role: draftRole, name: draftName }
			: undefined;
	return (
		<div className="max-w-2xl p-8">
			<div className="rounded-sm border border-line bg-surface">
				<FolderNameRow
					providerPath={providerPath}
					detectedRole={detectedRole}
					role={role}
					name={name}
					defaultDraft={defaultDraft}
					onCommit={(next) => {
						setRole(next.role);
						setName(next.name);
					}}
					onReset={() => {
						setRole(detectedRole);
						setName("");
					}}
				/>
			</div>
		</div>
	);
}

const meta: Meta<typeof RowHarness> = {
	title: "Settings/FolderNameRow",
	component: RowHarness,
};
export default meta;

type Story = StoryObj<typeof RowHarness>;

/** Recognized folder, no overrides — no trailing affordance. */
export const Default: Story = {
	args: { providerPath: "INBOX", detectedRole: "inbox" },
};

/** Pending edit — the draft differs from the committed value, so ✔️ shows. */
export const PendingEdit: Story = {
	args: {
		providerPath: "INBOX",
		detectedRole: "inbox",
		draftName: "Primary",
	},
};

/** A committed name override — ↺ shows (no pending edit). */
export const CommittedOverride: Story = {
	args: {
		providerPath: "INBOX",
		detectedRole: "inbox",
		committedName: "Primary",
	},
};

/** A "custom" folder committed-promoted to Sent — ↺ shows. */
export const RolePromotedToSent: Story = {
	args: {
		providerPath: "INBOX/Verzonden items",
		detectedRole: "custom",
		committedRole: "sent",
	},
};

/**
 * Demote escape hatch: a detected-Drafts folder with the draft role set to
 * Custom. ✔️ commits the demotion; in a list this folder then drops out, since
 * the list shows system folders only.
 */
export const DemoteToCustom: Story = {
	args: {
		providerPath: "INBOX/Concepten",
		detectedRole: "drafts",
		draftRole: "custom",
	},
};
