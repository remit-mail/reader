import { RichTextEditor, type RichTextValue } from "@remit/ui/rich-text";

interface ComposeBodyProps {
	initialHtml: string;
	onChange: (value: RichTextValue) => void;
	onSubmit?: () => void;
	autoFocus?: boolean;
}

export const ComposeBody = ({
	initialHtml,
	onChange,
	onSubmit,
	autoFocus,
}: ComposeBodyProps) => (
	<RichTextEditor
		initialHtml={initialHtml}
		onChange={onChange}
		onSubmit={onSubmit}
		autoFocus={autoFocus}
	/>
);
