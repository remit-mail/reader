import type { RemitImapLabelResponse } from "@remit/api-http-client/types.gen.ts";
import { Button, Input, LabelChip, labelColorOptions, Select } from "@remit/ui";
import { Trash2 } from "lucide-react";
import { useState } from "react";

interface LabelsListProps {
	labels: RemitImapLabelResponse[];
	onRename: (labelId: string, name: string) => void;
	onRecolor: (labelId: string, color: string) => void;
	onDelete: (label: RemitImapLabelResponse) => void;
	deletingLabelId?: string;
}

/**
 * The account's labels, each renamable and recolorable inline and deletable
 * with the cascade-confirming dialog the caller opens (issue #26). Mirrors
 * `FiltersList`'s row shape: a name, a color chip, and a destructive action.
 */
export function LabelsList({
	labels,
	onRename,
	onRecolor,
	onDelete,
	deletingLabelId,
}: LabelsListProps) {
	const [editingId, setEditingId] = useState<string>();
	const [draftName, setDraftName] = useState("");

	if (labels.length === 0) {
		return (
			<p className="py-6 text-sm text-fg-muted">
				No labels yet. Create one below, then use it in a filter or apply it to
				mail directly.
			</p>
		);
	}

	const commitRename = (labelId: string) => {
		const trimmed = draftName.trim();
		if (trimmed !== "") onRename(labelId, trimmed);
		setEditingId(undefined);
	};

	return (
		<ul className="divide-y divide-line rounded-md border border-line">
			{labels.map((label) => (
				<li key={label.labelId} className="flex items-center gap-3 px-3 py-2.5">
					<div className="min-w-0 flex-1">
						{editingId === label.labelId ? (
							<Input
								autoFocus
								value={draftName}
								onChange={(event) => setDraftName(event.target.value)}
								onBlur={() => commitRename(label.labelId)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										commitRename(label.labelId);
									}
									if (event.key === "Escape") {
										event.preventDefault();
										setEditingId(undefined);
									}
								}}
								aria-label={`Rename label ${label.name}`}
							/>
						) : (
							<button
								type="button"
								onClick={() => {
									setEditingId(label.labelId);
									setDraftName(label.name);
								}}
								aria-label={`Rename label ${label.name}`}
								className="flex items-center gap-2 rounded-sm text-left hover:opacity-80"
							>
								<LabelChip label={label} />
							</button>
						)}
						<p className="mt-0.5 text-xs text-fg-subtle">
							{label.filterCount === 0
								? "Not used in any filter"
								: `Used in ${label.filterCount} ${
										label.filterCount === 1 ? "filter" : "filters"
									}`}
						</p>
					</div>
					<Select
						aria-label={`Color for ${label.name}`}
						value={label.color}
						onChange={(event) => onRecolor(label.labelId, event.target.value)}
						className="w-28 shrink-0"
					>
						{labelColorOptions.map((color) => (
							<option key={color} value={color}>
								{color}
							</option>
						))}
					</Select>
					<Button
						variant="ghost"
						size="sm"
						icon={<Trash2 className="size-4 text-danger" />}
						onClick={() => onDelete(label)}
						disabled={deletingLabelId === label.labelId}
						aria-label={`Delete label ${label.name}`}
					/>
				</li>
			))}
		</ul>
	);
}
