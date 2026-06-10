import { AutoformatPlugin } from "@platejs/autoformat";
import {
	BlockquotePlugin,
	BoldPlugin,
	ItalicPlugin,
} from "@platejs/basic-nodes/react";
import { LinkPlugin } from "@platejs/link/react";
import type { Value } from "platejs";
import { PlateContent, usePlateEditor } from "platejs/react";
import { useEffect } from "react";

export interface PlateEditorProps {
	initialValue?: Value;
	onChange?: (value: Value) => void;
	onSubmit?: () => void;
	autoFocus?: boolean;
}

const EMPTY_VALUE: Value = [{ type: "p", children: [{ text: "" }] }];

export const COMPOSE_PLUGINS = [
	BoldPlugin,
	ItalicPlugin,
	LinkPlugin,
	BlockquotePlugin,
	AutoformatPlugin.configure({
		options: {
			rules: [
				{
					match: "**",
					mode: "mark" as const,
					type: "bold",
				},
				{
					match: "*",
					mode: "mark" as const,
					type: "italic",
				},
				{
					match: "> ",
					mode: "block" as const,
					type: "blockquote",
				},
			],
			enableUndoOnDelete: true,
		},
	}),
];

export const usePlateComposeEditor = (initialValue?: Value) =>
	usePlateEditor({
		plugins: COMPOSE_PLUGINS,
		value: initialValue ?? EMPTY_VALUE,
	});

export const PlateEditorContent = ({
	onSubmit,
	autoFocus,
	editor,
}: Omit<PlateEditorProps, "initialValue" | "onChange"> & {
	editor: ReturnType<typeof usePlateComposeEditor>;
}) => {
	useEffect(() => {
		if (autoFocus) {
			const timer = setTimeout(() => {
				editor.tf.focus();
			}, 0);
			return () => clearTimeout(timer);
		}
	}, [autoFocus, editor]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmit) {
			e.preventDefault();
			onSubmit();
		}
	};

	return (
		<PlateContent
			className="w-full px-3 py-2 bg-canvas text-sm outline-none min-h-[120px] [&_blockquote]:pl-3 [&_blockquote]:border-l-2 [&_blockquote]:border-fg-subtle/30 [&_blockquote]:text-fg-muted [&_a]:text-accent [&_a]:underline"
			placeholder="Write your message..."
			onKeyDown={handleKeyDown}
		/>
	);
};
