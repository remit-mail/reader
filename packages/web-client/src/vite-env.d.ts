/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_COGNITO_USER_POOL_ID?: string;
	readonly VITE_COGNITO_CLIENT_ID?: string;
	readonly VITE_COGNITO_DOMAIN?: string;
	readonly VITE_COGNITO_REGION?: string;
	readonly VITE_API_URL?: string;
	readonly VITE_APP_ORIGIN?: string;
	readonly VITE_RUM_APP_MONITOR_ID?: string;
	readonly VITE_RUM_IDENTITY_POOL_ID?: string;
	readonly VITE_AWS_REGION?: string;
	readonly VITE_DISABLE_DEVTOOLS?: string;
	readonly VITE_MAILBOX_POLL_INTERVAL_SECONDS?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare const __APP_SHA__: string;
declare const __APP_BUILD_TIME__: string;
