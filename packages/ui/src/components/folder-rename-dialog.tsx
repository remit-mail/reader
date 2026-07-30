import { X } from "lucide-react";
import { useId } from "react";
import { Button } from "./button.js";
import { Dialog } from "./dialog.js";
import { FieldLabel } from "./field-label.js";
import { Input } from "./input.js";

export interface FolderRenameDialogProps {
	open: boolean;
	/** The folder as it reads now. */
	folderLabel: string;
	/** What the folder falls back to once the name is cleared. */
	defaultLabel: string;
	name: string;
	onNameChange: (name: string) => void;
	onSubmit: () => void;
	onClose: () => void;
	pending?: boolean;
	error?: string;
}

/**
 * Renames a folder for this account. The name is Remit's own — the folder keeps
 * its place and its path on the mail server — so clearing it puts the folder
 * back to what the server calls it.
 */
export const FolderRenameDialog = ({
	open,
	folderLabel,
	defaultLabel,
	name,
	onNameChange,
	onSubmit,
	onClose,
	pending = false,
	error,
}: FolderRenameDialogProps) => {
	const fieldId = useId();
	const title = `Rename ${folderLabel}`;

	if (!open) return null;

	return (
		<Dialog open={open} onClose={onClose} title={title}>
			<header className="flex items-center gap-2 border-b border-line px-5 py-3">
				<span className="flex-1 text-sm font-semibold text-fg">{title}</span>
				<Button
					variant="ghost"
					size="sm"
					icon={<X className="size-3.5" />}
					onClick={onClose}
					aria-label="Cancel"
				/>
			</header>
			<div className="space-y-3 px-5 py-4">
				<div>
					<FieldLabel htmlFor={fieldId}>Folder name</FieldLabel>
					<Input
						id={fieldId}
						value={name}
						placeholder={defaultLabel}
						onChange={(event) => onNameChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							onSubmit();
						}}
					/>
				</div>
				<p className="text-xs text-fg-muted">
					Shown everywhere in Remit. Leave it blank to use{" "}
					<span className="font-medium text-fg">{defaultLabel}</span>.
				</p>
				{error && (
					<p className="text-xs text-danger" role="alert">
						{error}
					</p>
				)}
			</div>
			<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
				<Button variant="secondary" size="sm" onClick={onClose}>
					Cancel
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={onSubmit}
					disabled={pending}
				>
					{pending ? "Saving…" : "Save name"}
				</Button>
			</footer>
		</Dialog>
	);
};
