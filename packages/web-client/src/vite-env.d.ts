/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_COGNITO_USER_POOL_ID?: string;
	readonly VITE_COGNITO_CLIENT_ID?: string;
	readonly VITE_COGNITO_DOMAIN?: string;
	readonly VITE_COGNITO_REGION?: string;
	readonly VITE_API_URL?: string;
	readonly VITE_APP_ORIGIN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
