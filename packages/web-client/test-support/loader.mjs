import { pathToFileURL } from "node:url";

const stubsDir = pathToFileURL(`${import.meta.dirname}/stubs/`).href;

const packageStubs = new Map([
	["aws-amplify", `${stubsDir}aws-amplify.mjs`],
	["aws-amplify/auth", `${stubsDir}aws-amplify-auth.mjs`],
	// `@aws-amplify/ui-react` transitively imports `aws-amplify/auth` symbols
	// (deleteUser, updatePassword, …) that our `aws-amplify/auth` test stub
	// doesn't export — loading it in Node tests crashes at module init.
	// Stub the package so tests that import a component using
	// `useAuthenticator` can still be loaded.
	["@aws-amplify/ui-react", `${stubsDir}aws-amplify-ui-react.mjs`],
	["@remit/api-http-client/client.gen.ts", `${stubsDir}remit-client.mjs`],
	["aws-rum-web", `${stubsDir}aws-rum-web.mjs`],
]);

const amplifyConfigStubUrl = `${stubsDir}amplify-config.mjs`;

const isAuthSourceUrl = (url) => url.includes("/remit-web-client/src/auth/");
const isInterceptorSource = (url) =>
	url.includes("/remit-web-client/src/auth/auth-interceptor.ts");
const isAppInfoSource = (url) =>
	url.includes("/remit-web-client/src/lib/app-info.");
const isRumAdapterSource = (url) =>
	url.includes("/remit-web-client/src/lib/rum-adapter.");

export const resolve = async (specifier, context, nextResolve) => {
	const stub = packageStubs.get(specifier);
	if (stub) return { url: stub, shortCircuit: true, format: "module" };

	const parent = context?.parentURL ?? "";
	if (
		isInterceptorSource(parent) &&
		(specifier === "./amplify-config" || specifier === "./amplify-config.ts")
	) {
		return {
			url: amplifyConfigStubUrl,
			shortCircuit: true,
			format: "module",
		};
	}

	return nextResolve(specifier, context);
};

export const load = async (url, context, nextLoad) => {
	const result = await nextLoad(url, context);
	if (result.format !== "module") return result;
	if (
		typeof result.source !== "string" &&
		!(result.source instanceof Uint8Array)
	) {
		return result;
	}
	const raw =
		typeof result.source === "string"
			? result.source
			: new TextDecoder().decode(result.source);

	let transformed = raw;

	if (isAuthSourceUrl(url) || isRumAdapterSource(url)) {
		transformed = transformed.replaceAll(
			"import.meta.env",
			"(globalThis.__VITE_ENV__ ?? {})",
		);
	}

	if (isAppInfoSource(url)) {
		// Replace Vite define constants with test-time fallbacks so the module
		// can be imported in Node test runs (outside a Vite build context).
		transformed = transformed
			.replaceAll("__APP_SHA__", '"dev"')
			.replaceAll("__APP_BUILD_TIME__", '"1970-01-01T00:00:00.000Z"');
	}

	if (transformed === raw) return result;
	return { ...result, source: transformed };
};
