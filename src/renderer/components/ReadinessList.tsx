import { Button } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../store/settingsStore";

type Props = { onOpenSettings: () => void };

// Only whether a value is non-empty is read: secrets never reach the markup.
export const ReadinessList = ({ onOpenSettings }: Props) => {
  const { t } = useTranslation();
  const hasApiKey = useSettingsStore((s) => s.apiKey.trim() !== "");
  const hasAzure = useSettingsStore(
    (s) => s.azureSpeechKey.trim() !== "" && s.azureRegion.trim() !== "",
  );

  const missing = [
    !hasApiKey && {
      label: t("readiness.apiKey.label"),
      effect: t("readiness.apiKey.effect"),
    },
    !hasAzure && {
      label: t("readiness.azure.label"),
      effect: t("readiness.azure.effect"),
    },
  ].filter((m) => m !== false);

  if (missing.length === 0) return null;

  return (
    <section aria-label={t("readiness.label")} className="readiness-list">
      <ul className="list-unstyled mb-0">
        {missing.map((m) => (
          <li key={m.label} className="readiness-item">
            <span>
              <strong>{m.label}</strong> · {m.effect}
            </span>
            <Button size="sm" variant="secondary" onClick={onOpenSettings}>
              {t("readiness.set")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
};
