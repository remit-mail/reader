import {
	BlockquotePlugin,
	BoldPlugin,
	ItalicPlugin,
} from "@platejs/basic-nodes/react";
import { insertLink } from "@platejs/link";
import { Bold, Italic, Link, Quote } from "lucide-react";
import { useEditorRef, useEditorSelector } from "platejs/react";

const ToolbarButton = ({
	isActive,
	onClick,
	children,
	title,
}: {
	isActive: boolean;
	onClick: () => void;
	children: React.ReactNode;
	title: string;
}) => (
	<button
		type="button"
		onMouseDown={(e) => {
			e.preventDefault();
			onClick();
		}}
		title={title}
		className={`p-1.5 rounded transition-colors ${
			isActive
				? "text-foreground bg-accent"
				: "text-muted-foreground hover:text-foreground hover:bg-accent/50"
		}`}
	>
		{children}
	</button>
);

export const PlateToolbar = () => {
	const editor = useEditorRef();

	const isBoldActive = useEditorSelector(
		(editor) => !!editor.api.mark(BoldPlugin.key),
		[],
	);
	const isItalicActive = useEditorSelector(
		(editor) => !!editor.api.mark(ItalicPlugin.key),
		[],
	);
	const isBlockquoteActive = useEditorSelector((editor) => {
		const entry = editor.api.block();
		return entry ? entry[0].type === BlockquotePlugin.key : false;
	}, []);

	return (
		<div className="flex items-center gap-0.5 px-3 py-1 border-b border-border">
			<ToolbarButton
				isActive={isBoldActive}
				onClick={() => editor.tf.toggleMark(BoldPlugin.key)}
				title="Bold (Ctrl+B)"
			>
				<Bold className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				isActive={isItalicActive}
				onClick={() => editor.tf.toggleMark(ItalicPlugin.key)}
				title="Italic (Ctrl+I)"
			>
				<Italic className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				isActive={false}
				onClick={() => insertLink(editor, { url: "" })}
				title="Link (Ctrl+K)"
			>
				<Link className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				isActive={isBlockquoteActive}
				onClick={() => editor.tf.toggleBlock(BlockquotePlugin.key)}
				title="Blockquote"
			>
				<Quote className="size-4" />
			</ToolbarButton>
		</div>
	);
};
