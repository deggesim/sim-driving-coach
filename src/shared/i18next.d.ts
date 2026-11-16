import type it from "./locales/it.json";
import type guideIt from "./locales/guide/it.json";

declare module "i18next" {
  type CustomTypeOptions = {
    defaultNS: "translation";
    resources: { translation: typeof it; guide: typeof guideIt };
  };
}
