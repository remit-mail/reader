import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Input, type InputProps } from "./input.js";

/**
 * Everything `Input` takes except the field chrome this component owns:
 * `type` flips between "password" and "text", `trailing` holds the toggle, and
 * the reveal button's inset assumes the boxed `default` variant.
 */
export type PasswordInputProps = Omit<
	InputProps,
	"type" | "trailing" | "variant"
>;

/**
 * A password field with an in-field reveal toggle. Only `type` changes when
 * revealed — `name`, `autoComplete` and the rest reach the input untouched, so
 * password managers and autofill behave exactly as they do on a bare field.
 */
export function PasswordInput(props: PasswordInputProps) {
	const [revealed, setRevealed] = useState(false);
	const RevealIcon = revealed ? EyeOff : Eye;
	const label = revealed ? "Hide password" : "Show password";

	return (
		<Input
			{...props}
			type={revealed ? "text" : "password"}
			trailing={
				// Negative margins grow the hit area to 44px square without
				// changing the field's height.
				<button
					type="button"
					aria-label={label}
					aria-pressed={revealed}
					title={label}
					onClick={() => setRevealed((shown) => !shown)}
					className="-my-1 -mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-subtle transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<RevealIcon className="size-4" aria-hidden />
				</button>
			}
		/>
	);
}
