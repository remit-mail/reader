export type OptionsResult =
	| { readonly ok: true; readonly values: ReadonlyMap<string, string> }
	| { readonly ok: false; readonly message: string };

export const parseOptions = (
	command: string,
	args: readonly string[],
	allowed: readonly string[],
): OptionsResult => {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index] ?? "";
		const name = flag.replace(/^--/, "");
		if (!flag.startsWith("--") || !allowed.includes(name)) {
			return { ok: false, message: `${command}: unknown option '${flag}'` };
		}
		const value = args[index + 1];
		if (value === undefined || value.startsWith("--")) {
			return { ok: false, message: `${command}: ${flag} needs a value` };
		}
		values.set(name, value);
	}
	return { ok: true, values };
};
