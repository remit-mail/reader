export type TargetKind = "standalone" | "cloudflare";

export interface Target {
	readonly kind: TargetKind;
	readonly apiUrl: string;
	readonly origin: string;
}

export interface Invocation {
	readonly target: Target;
	readonly command: string;
	readonly args: readonly string[];
}

export type InvocationResult =
	| ({ readonly ok: true } & Invocation)
	| { readonly ok: false; readonly message: string };

export const STANDALONE_API_URL = "http://apisix:9080";
const EXAMPLE = "https://app.remit.email/api";

type UrlResult =
	| { readonly ok: true; readonly apiUrl: string; readonly origin: string }
	| { readonly ok: false; readonly message: string };

const parseUrl = (raw: string): UrlResult => {
	if (!URL.canParse(raw)) {
		return { ok: false, message: `'${raw}' is not a URL, e.g. ${EXAMPLE}` };
	}
	const url = new URL(raw);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return {
			ok: false,
			message: `'${raw}' is not an http or https URL, e.g. ${EXAMPLE}`,
		};
	}
	const path = url.pathname.replace(/\/+$/, "");
	return {
		ok: true,
		apiUrl: `${url.origin}${path === "" ? "/api" : path}`,
		origin: url.origin,
	};
};

const isKind = (value: string): value is TargetKind =>
	value === "standalone" || value === "cloudflare";

interface Globals {
	readonly kind: string | undefined;
	readonly url: string | undefined;
	readonly rest: readonly string[];
}

type GlobalsResult =
	| ({ readonly ok: true } & Globals)
	| { readonly ok: false; readonly message: string };

const readGlobals = (argv: readonly string[]): GlobalsResult => {
	let kind: string | undefined;
	let url: string | undefined;
	let index = 0;
	while (index < argv.length) {
		const arg = argv[index] ?? "";
		const [flag, inline] = arg.includes("=")
			? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
			: [arg, undefined];
		if (flag !== "--target" && flag !== "--api-url") break;
		const value = inline ?? argv[index + 1];
		if (value === undefined || value === "") {
			return {
				ok: false,
				message:
					flag === "--target"
						? "--target needs standalone or cloudflare"
						: `--api-url needs a URL, e.g. ${EXAMPLE}`,
			};
		}
		if (flag === "--target") kind = value;
		else url = value;
		index += inline === undefined ? 2 : 1;
	}
	return { ok: true, kind, url, rest: argv.slice(index) };
};

export const parseInvocation = (
	argv: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
): InvocationResult => {
	const globals = readGlobals(argv);
	if (!globals.ok) return globals;
	const envUrl = env.REMIT_API_URL === "" ? undefined : env.REMIT_API_URL;
	const kind =
		globals.kind ??
		(globals.url === undefined && envUrl === undefined
			? "standalone"
			: "cloudflare");
	if (!isKind(kind)) {
		return {
			ok: false,
			message: `--target '${kind}' is not standalone or cloudflare`,
		};
	}
	const raw = globals.url ?? envUrl;
	const [command = "help", ...args] = globals.rest;
	if (raw === undefined && kind === "cloudflare") {
		return {
			ok: false,
			message: `the cloudflare target needs its URL: set REMIT_API_URL or pass --api-url, e.g. ${EXAMPLE}`,
		};
	}
	if (raw === undefined) {
		return {
			ok: true,
			target: {
				kind,
				apiUrl: STANDALONE_API_URL,
				origin: STANDALONE_API_URL,
			},
			command,
			args,
		};
	}
	const url = parseUrl(raw);
	if (!url.ok) return url;
	return {
		ok: true,
		target: { kind, apiUrl: url.apiUrl, origin: url.origin },
		command,
		args,
	};
};
