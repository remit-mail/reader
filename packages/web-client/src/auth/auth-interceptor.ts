import { client } from "@remit/api-http-client/client.gen.ts";
import { fetchAuthSession } from "aws-amplify/auth";
import { isCognitoConfigured } from "./amplify-config";

let installed = false;

const getIdToken = async (): Promise<string | null> => {
	const session = await fetchAuthSession();
	const token = session.tokens?.idToken?.toString();
	return token ?? null;
};

export const installAuthInterceptor = (): void => {
	if (installed) return;
	if (!isCognitoConfigured()) return;

	client.interceptors.request.use(async (request) => {
		const token = await getIdToken();
		if (token) {
			request.headers.set("Authorization", `Bearer ${token}`);
		}
		return request;
	});

	installed = true;
};
