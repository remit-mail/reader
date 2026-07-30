import { useEffect, useId, useRef } from "react";
import { Button } from "./button.js";
import { FieldLabel } from "./field-label.js";
import { Input } from "./input.js";

export interface NewFolderFormLabels {
	nameLabel?: string;
	namePlaceholder?: string;
	/** Precedes the parent, e.g. `Inside Travel`. */
	insideLabel?: string;
	create?: string;
	cancel?: string;
	createPending?: string;
}

export const defaultNewFolderFormLabels: Required<NewFolderFormLabels> = {
	nameLabel: "Folder name",
	namePlaceholder: "Hotels",
	insideLabel: "Inside",
	create: "Create folder",
	cancel: "Cancel",
	createPending: "Creating folder…",
};

export interface NewFolderFormProps {
	/** Where the folder is made, stated as text rather than a second choice. */
	parentLabel: string;
	name: string;
	onNameChange: (name: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
	/** The mail server has the request and has not confirmed it yet. */
	pending?: boolean;
	error?: string;
	labels?: NewFolderFormLabels;
}

/**
 * Names a folder and holds the wait while the mail server makes it. Opens
 * focused and in view, states a failure in place, and refuses a second submit
 * while the first is still out.
 */
export const NewFolderForm = ({
	parentLabel,
	name,
	onNameChange,
	onSubmit,
	onCancel,
	pending = false,
	error,
	labels,
}: NewFolderFormProps) => {
	const text = { ...defaultNewFolderFormLabels, ...labels };
	const fieldId = useId();
	const nameRef = useRef<HTMLInputElement>(null);
	const formRef = useRef<HTMLDivElement>(null);

	/**
	 * The whole form is brought into view, buttons included — focusing the field
	 * would otherwise scroll to the field alone and leave Create below the fold,
	 * under a footer or a soft keyboard.
	 */
	useEffect(() => {
		nameRef.current?.focus({ preventScroll: true });
		formRef.current?.scrollIntoView({ block: "nearest" });
	}, []);

	return (
		<div
			ref={formRef}
			className="space-y-3 border-y border-line bg-surface-sunken px-3 py-3"
		>
			<div>
				<FieldLabel htmlFor={fieldId}>{text.nameLabel}</FieldLabel>
				<Input
					id={fieldId}
					ref={nameRef}
					value={name}
					placeholder={text.namePlaceholder}
					onChange={(event) => onNameChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							onSubmit();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							onCancel();
						}
					}}
				/>
			</div>
			<p className="text-xs text-fg-muted">
				{text.insideLabel}{" "}
				<span className="font-medium text-fg">{parentLabel}</span>
			</p>
			{error && (
				<p className="text-xs text-danger" role="alert">
					{error}
				</p>
			)}
			{/* Sized to their labels rather than to the pane: a full-width primary
			    here reads as loudly as the wizard's Continue below it, and making a
			    folder is the smaller commitment of the two. */}
			<div className="flex items-center gap-2">
				<Button
					variant="ghost"
					size="md"
					onClick={onCancel}
					className="min-h-11 shrink-0"
				>
					{text.cancel}
				</Button>
				<Button
					variant="secondary"
					size="md"
					onClick={onSubmit}
					disabled={pending}
					className="min-h-11 shrink-0"
				>
					{pending ? text.createPending : text.create}
				</Button>
			</div>
		</div>
	);
};
