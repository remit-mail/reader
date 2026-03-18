import type { Value } from "platejs";
import { Plate } from "platejs/react";
import { PlateEditorContent, usePlateComposeEditor } from "./PlateEditor.js";
import { PlateToolbar } from "./PlateToolbar.js";

interface ComposeBodyProps {
	value: Value;
	onChange: (value: Value) => void;
	onSubmit?: () => void;
	autoFocus?: boolean;
}

export const ComposeBody = ({
	value,
	onChange,
	onSubmit,
	autoFocus,
}: ComposeBodyProps) => {
	const editor = usePlateComposeEditor(value);

	return (
		<Plate
			editor={editor}
			onValueChange={({ value: v }) => {
				onChange(v);
			}}
		>
			<PlateToolbar />
			<PlateEditorContent
				editor={editor}
				onSubmit={onSubmit}
				autoFocus={autoFocus}
			/>
		</Plate>
	);
};
