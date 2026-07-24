import { Button, Input } from "@remit/ui";
import { ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import type { OrganizeSeed } from "@/lib/organize/mobile-organize-flow";

export interface FolderOption {
	id: string;
	label: string;
}

interface SomethingElsePanelProps {
	/** The account's move destinations, the same set the sentence's folder picker uses. */
	folderOptions: FolderOption[];
	/** The appointed Junk mailbox, offered as a shortcut when present. */
	junkMailboxId?: string;
	/** Chosen shortcut or parsed input — seeds the organize sentence's folder/scope. */
	onSeed: (seed: OrganizeSeed) => void;
}

interface Shortcut {
	id: string;
	label: string;
	seed: OrganizeSeed;
}

const findFolder = (
	folderOptions: FolderOption[],
	label: string,
): FolderOption | undefined =>
	folderOptions.find((folder) => folder.label.toLowerCase() === label);

/**
 * Shortcuts are derived from the account's real folders — there is no
 * suggestion endpoint, so the panel offers the moves it can actually commit:
 * keep it in the Inbox as a standing rule, file it in Archive, or send it to
 * the appointed Junk mailbox. Each seeds the organize sentence; the user still
 * confirms the scope.
 */
const buildShortcuts = (
	folderOptions: FolderOption[],
	junkMailboxId: string | undefined,
): Shortcut[] => {
	const shortcuts: Shortcut[] = [];
	const inbox = findFolder(folderOptions, "inbox");
	if (inbox) {
		shortcuts.push({
			id: "keep-inbox",
			label: "Always keep in Inbox",
			seed: { moveMailboxId: inbox.id, scope: "standing" },
		});
	}
	const archive = findFolder(folderOptions, "archive");
	if (archive) {
		shortcuts.push({
			id: "file-archive",
			label: "File in Archive",
			seed: { moveMailboxId: archive.id },
		});
	}
	const junk = junkMailboxId
		? folderOptions.find((folder) => folder.id === junkMailboxId)
		: undefined;
	if (junk) {
		shortcuts.push({
			id: "move-junk",
			label: `Move to ${junk.label}`,
			seed: { moveMailboxId: junk.id },
		});
	}
	return shortcuts;
};

/**
 * Reads a plain-language instruction into a seed without an NLP endpoint: it
 * matches the typed words against the account's own folder names and reads an
 * "always"/"keep" phrasing as the standing scope. Whatever it can't resolve to
 * a folder still opens the sentence, where the picker is one tap away — never a
 * dead end.
 */
const parseInstruction = (
	text: string,
	folderOptions: FolderOption[],
): OrganizeSeed => {
	const lower = text.toLowerCase();
	const folder = folderOptions.find((option) =>
		lower.includes(option.label.toLowerCase()),
	);
	const standing = /\b(always|keep|future|from now)\b/.test(lower);
	return {
		moveMailboxId: folder?.id,
		scope: standing ? "standing" : undefined,
	};
};

/**
 * The "Something else" fallback (issue #211): smart shortcuts plus a
 * plain-language input, both of which seed the organize sentence's folder and
 * scope. Presentational — the flow owns the folder data and what a seed does.
 */
export function SomethingElsePanel({
	folderOptions,
	junkMailboxId,
	onSeed,
}: SomethingElsePanelProps) {
	const [text, setText] = useState("");
	const shortcuts = useMemo(
		() => buildShortcuts(folderOptions, junkMailboxId),
		[folderOptions, junkMailboxId],
	);

	const submit = () => {
		const trimmed = text.trim();
		if (!trimmed) return;
		onSeed(parseInstruction(trimmed, folderOptions));
	};

	return (
		<div className="flex min-h-0 flex-col">
			<div className="border-b border-line px-5 py-3">
				<h2 className="text-sm font-semibold text-fg">What should Remit do?</h2>
				<p className="mt-0.5 text-xs text-fg-muted">
					Pick a shortcut or say it in your own words.
				</p>
			</div>

			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
				{shortcuts.map((shortcut) => (
					<Button
						key={shortcut.id}
						variant="secondary"
						onClick={() => onSeed(shortcut.seed)}
						className="h-12 w-full justify-start px-4"
					>
						{shortcut.label}
					</Button>
				))}
			</div>

			<div className="flex items-center gap-2 border-t border-line px-5 py-3">
				<Input
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => event.key === "Enter" && submit()}
					placeholder="Tell Remit what to do…"
					aria-label="Tell Remit what to do"
					className="flex-1"
				/>
				<Button
					variant="primary"
					aria-label="Send"
					onClick={submit}
					disabled={!text.trim()}
					icon={<ArrowUp className="size-4" />}
					className="size-9 shrink-0 px-0"
				/>
			</div>
		</div>
	);
}
