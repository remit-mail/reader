import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import {
	BottomSheet,
	Dialog,
	type FolderOption,
	type LabelOption,
} from "@remit/ui";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { FilterEditor } from "./FilterEditor";

interface FilterEditorSurfaceProps {
	accountId: string;
	filter: RemitImapFilterResponse;
	folders: FolderOption[];
	labels: LabelOption[];
	semanticUnavailable?: boolean;
	onClose: () => void;
}

/**
 * The settings filter editor in its responsive home: the centered dialog on
 * desktop, the bottom sheet on mobile (RFC 038 D1), mounting the same
 * {@link FilterEditor} so the two can never drift. Opened from a filter row in
 * Settings › Filters.
 */
export function FilterEditorSurface({
	accountId,
	filter,
	folders,
	labels,
	semanticUnavailable,
	onClose,
}: FilterEditorSurfaceProps) {
	const isDesktop = useIsDesktop();

	const editor = (
		<FilterEditor
			accountId={accountId}
			filter={filter}
			folders={folders}
			labels={labels}
			semanticUnavailable={semanticUnavailable}
			onClose={onClose}
		/>
	);

	if (isDesktop) {
		return (
			<Dialog open onClose={onClose} title="Filter rule">
				{editor}
			</Dialog>
		);
	}

	return (
		<BottomSheet open onClose={onClose} dismissLabel="Dismiss filter rule">
			{editor}
		</BottomSheet>
	);
}
