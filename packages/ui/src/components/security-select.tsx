import type { SelectProps } from "./select.js";
import { Select } from "./select.js";

export type ServerSecurity = "tls" | "starttls" | "none";

export interface SecuritySelectProps
	extends Omit<
		SelectProps,
		"value" | "defaultValue" | "onChange" | "children"
	> {
	value?: ServerSecurity;
	defaultValue?: ServerSecurity;
	onValueChange?: (value: ServerSecurity) => void;
}

export function SecuritySelect({
	value,
	defaultValue,
	onValueChange,
	...props
}: SecuritySelectProps) {
	if (onValueChange) {
		return (
			<Select
				value={value}
				onChange={(e) => onValueChange(e.target.value as ServerSecurity)}
				{...props}
			>
				<option value="tls">TLS/SSL</option>
				<option value="starttls">STARTTLS</option>
				<option value="none">None (insecure)</option>
			</Select>
		);
	}

	return (
		<Select defaultValue={defaultValue ?? value} {...props}>
			<option value="tls">TLS/SSL</option>
			<option value="starttls">STARTTLS</option>
			<option value="none">None (insecure)</option>
		</Select>
	);
}

export function securityToApi(security: ServerSecurity): {
	tls: boolean;
	startTls: boolean;
} {
	return {
		tls: security === "tls",
		startTls: security === "starttls",
	};
}
