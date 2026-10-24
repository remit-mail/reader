export interface Target {
	readonly apiUrl: string;
	readonly appUrl: string;
}

export type TargetResult =
	| { readonly ok: true; readonly target: Target }
	| { readonly ok: false; readonly message: string };

const EXAMPLE = "https://app.remit.email/api";

export const resolveTarget = (raw: string | undefined): TargetResult => {
	if (raw === undefined || raw.trim() === "") {
		return {
			ok: false,
			message: `no remote target: set REMIT_API_URL or pass --api-url, e.g. ${EXAMPLE}`,
		};
	}
	if (!URL.canParse(raw)) {
		return {
			ok: false,
			message: `REMIT_API_URL '${raw}' is not a URL, e.g. ${EXAMPLE}`,
		};
	}
	const url = new URL(raw);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return {
			ok: false,
			message: `REMIT_API_URL '${raw}' is not an http or https URL, e.g. ${EXAMPLE}`,
		};
	}
	const path = url.pathname.replace(/\/+$/, "");
	return {
		ok: true,
		target: {
			apiUrl: `${url.origin}${path === "" ? "/api" : path}`,
			appUrl: url.origin,
		},
	};
};
