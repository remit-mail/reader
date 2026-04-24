import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
	origin?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(ctx: RequestContext, fn: () => T): T =>
	storage.run(ctx, fn);

export const getRequestOrigin = (): string | undefined =>
	storage.getStore()?.origin;

const parseAllowedOrigins = (): readonly string[] => {
	const raw = process.env.CORS_ALLOWED_ORIGINS;
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
};

export const resolveAllowedOrigin = (origin: string | undefined): string => {
	const allowed = parseAllowedOrigins();
	if (allowed.length === 0) return "*";
	if (origin && allowed.includes(origin)) return origin;
	return allowed[0];
};
