import { Button } from "react-bootstrap";
import { useSettingsStore } from "../store/settingsStore";

type Props = { onOpenSettings: () => void };

// Only whether a value is non-empty is read: secrets never reach the markup.
export const ReadinessList = ({ onOpenSettings }: Props) => {
  const hasApiKey = useSettingsStore((s) => s.apiKey.trim() !== "");
  const hasAzure = useSettingsStore(
    (s) => s.azureSpeechKey.trim() !== "" && s.azureRegion.trim() !== "",
  );

  const missing = [
    !hasApiKey && {
      label: "Chiave API Claude",
      effect: "Senza, «Esegui analisi» non produce il debriefing.",
    },
    !hasAzure && {
      label: "Voce Azure (chiave e regione)",
      effect:
        "Senza, niente comandi a voce né dettatura; gli avvisi in giro usano la voce del sistema.",
    },
  ].filter((m) => m !== false);

  if (missing.length === 0) return null;

  return (
    <section aria-label="Configurazione mancante" className="readiness-list">
      <ul className="list-unstyled mb-0">
        {missing.map((m) => (
          <li key={m.label} className="readiness-item">
            <span>
              <strong>{m.label}</strong> · {m.effect}
            </span>
            <Button size="sm" variant="secondary" onClick={onOpenSettings}>
              Imposta
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
};
