import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
	input: "./build/remit-openapi3/openapi.json",
	output: "./build/remit-client",
	plugins: [
		"@hey-api/client-fetch",
		"@hey-api/sdk",
		{
			name: "@tanstack/react-query",
			queryOptions: true,
		},
	],
});
