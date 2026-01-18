import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import Backend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";

i18n
	.use(Backend)
	.use(LanguageDetector)
	.use(initReactI18next)
	.init({
		fallbackLng: "en",
		supportedLngs: ["en", "nl", "de", "fr"],

		ns: ["common", "mail", "settings", "errors"],
		defaultNS: "common",

		backend: {
			loadPath: "/locales/{{lng}}/{{ns}}.json",
		},

		detection: {
			order: ["navigator", "htmlTag"],
			caches: [],
		},

		interpolation: {
			escapeValue: false,
		},

		react: {
			useSuspense: true,
			bindI18n: "languageChanged loaded",
		},
	});

export default i18n;
