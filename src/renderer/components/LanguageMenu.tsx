import { Dropdown } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { LANGUAGES } from "../../shared/i18n";
import { useSettingsStore } from "../store/settingsStore";
import { LanguageFlag } from "./LanguageFlag";

export const LanguageMenu = () => {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const current = LANGUAGES.find((l) => l.code === language)!;
  return (
    <Dropdown align="end" className="language-menu">
      <Dropdown.Toggle
        variant="link"
        className="language-toggle"
        aria-label={t("language.label")}
        title={t("language.label")}
      >
        <LanguageFlag code={current.code} />
        <span>{current.native}</span>
      </Dropdown.Toggle>
      <Dropdown.Menu variant="dark">
        {LANGUAGES.map((l) => (
          <Dropdown.Item
            key={l.code}
            active={l.code === language}
            onClick={() => setLanguage(l.code)}
          >
            <LanguageFlag code={l.code} />
            <span>{l.native}</span>
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
};
