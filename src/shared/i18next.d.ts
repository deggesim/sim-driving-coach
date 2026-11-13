import type it from "./locales/it.json";

declare module "i18next" {
  type CustomTypeOptions = {
    defaultNS: "translation";
    resources: { translation: typeof it };
  };
}
