import { webClientPreset } from "@remit/web-client/vite-preset";
import { defineConfig } from "vite";

export default defineConfig(webClientPreset({ entry: "src/main.tsx" }));
