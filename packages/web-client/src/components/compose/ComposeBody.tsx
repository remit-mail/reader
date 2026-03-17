import { useCallback, useEffect, useRef } from "react";

interface ComposeBodyProps {
	value: string;
	onChange: (value: string) => void;
	onSubmit?: () => void;
	autoFocus?: boolean;
}

export const ComposeBody = ({
	value,
	onChange,
	onSubmit,
	autoFocus,
}: ComposeBodyProps) => {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const adjustHeight = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.max(textarea.scrollHeight, 120)}px`;
	}, []);

	useEffect(() => {
		adjustHeight();
	}, [value, adjustHeight]);

	useEffect(() => {
		if (autoFocus) {
			textareaRef.current?.focus();
		}
	}, [autoFocus]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmit) {
				e.preventDefault();
				onSubmit();
			}
		},
		[onSubmit],
	);

	return (
		<textarea
			ref={textareaRef}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			onKeyDown={handleKeyDown}
			className="w-full px-3 py-2 bg-background text-sm resize-none outline-none min-h-[120px]"
			placeholder="Write your message..."
		/>
	);
};
