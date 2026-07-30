import { FolderPlus } from "lucide-react";
import { cn } from "../lib/cn.js";
import {
	FOLDER_ROW_BASE,
	FolderRowIndent,
	FolderRowSeparator,
} from "./folder-row.js";

/**
 * How loudly a create action asks to be noticed. The pinned top-level one takes
 * the kit's dashed "add" affordance; the one inside an opened folder stays
 * neutral so it reads as the last thing in that folder rather than as a rival
 * to the pinned one.
 */
export type NewFolderProminence = "prominent" | "quiet";

export interface NewFolderActionProps {
	label: string;
	/** Names the folder it makes one inside, e.g. `New folder inside Travel`. */
	ariaLabel: string;
	/** Indents it to sit among the children of the folder it belongs to. */
	depth?: number;
	prominence?: NewFolderProminence;
	/** A hairline under the label, drawn for every row but the last. */
	separated?: boolean;
	onOpen: () => void;
}

/** Makes a folder where the user is looking, as a row in the list. */
export const NewFolderAction = ({
	label,
	ariaLabel,
	depth = 0,
	prominence = "prominent",
	separated = false,
	onOpen,
}: NewFolderActionProps) => (
	<div className={cn("relative", prominence === "prominent" && "p-2")}>
		<button
			type="button"
			onClick={onOpen}
			aria-label={ariaLabel}
			data-prominence={prominence}
			className={cn(
				FOLDER_ROW_BASE,
				"w-full active:bg-surface-sunken",
				prominence === "prominent"
					? "rounded-lg border border-line-strong border-dashed font-medium text-fg-muted hover:border-accent-2 hover:text-accent-2"
					: "text-fg-subtle hover:bg-surface-raised hover:text-fg-muted",
			)}
		>
			<FolderRowIndent depth={depth} />
			<span aria-hidden="true" className="size-4 shrink-0" />
			<FolderPlus className="size-4 shrink-0" aria-hidden="true" />
			<span className="min-w-0 flex-1 truncate">{label}</span>
		</button>
		{separated && <FolderRowSeparator depth={depth} />}
	</div>
);
