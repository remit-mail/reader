import { client } from "@remit/api-http-client/client.gen.ts";
import type { AuthProvider } from "./provider";

let installed = false;

/**
 * Attach the composed provider's bearer token to every API request. Called once
 * from `mountApp` with the app's chosen provider, so the token source is the
 * same `AuthProvider` the shell and screens read — no separate seam.
 */
export const installAuthInterceptor = (authProvider: AuthProvider): void => {
	if (installed) return;

	client.interceptors.request.use(async (request) => {
		const token = await authProvider.getToken();
		if (token) {
			request.headers.set("Authorization", `Bearer ${token}`);
		}
		return request;
	});

	installed = true;
};
