import { client } from "@remit/api-http-client/client.gen.ts";
import { fetchAuthToken } from "./auth-token";

let installed = false;

export const installAuthInterceptor = (): void => {
	if (installed) return;

	client.interceptors.request.use(async (request) => {
		const token = await fetchAuthToken();
		if (token) {
			request.headers.set("Authorization", `Bearer ${token}`);
		}
		return request;
	});

	installed = true;
};
