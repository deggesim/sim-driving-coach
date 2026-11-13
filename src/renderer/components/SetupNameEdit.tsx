import { useState } from "react";
import { Button, Form } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faPen, faXmark } from "@fortawesome/free-solid-svg-icons";

type Props = {
  name: string;
  /** Nomi già in uso nello storico auto/circuito: un duplicato collasserebbe
   *  due righe nella lista, che deduplica per nome. */
  takenNames: string[];
  onRename: (name: string) => void;
};

/** Nome setup con matita per la modifica in linea. Usato nella lista setup e
 *  nel titolo del dettaglio. */
export const SetupNameEdit = ({ name, takenNames, onRename }: Props) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);

  if (draft == null)
    return (
      <span className="d-inline-flex align-items-center gap-2">
        {name}
        <Button
          variant="link"
          size="sm"
          className="text-muted p-0"
          title={t("setupName.rename")}
          aria-label={t("setupName.rename")}
          onClick={(e) => {
            e.stopPropagation();
            setDraft(name);
          }}
        >
          <FontAwesomeIcon icon={faPen} />
        </Button>
      </span>
    );

  const trimmed = draft.trim();
  const invalid =
    !trimmed || (trimmed !== name && takenNames.includes(trimmed));
  const save = (): void => {
    if (invalid) return;
    setDraft(null);
    if (trimmed !== name) onRename(trimmed);
  };

  return (
    // stopPropagation: nella lista il click sulla riga apre il dettaglio
    <span
      className="d-inline-flex align-items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <Form.Control
        size="sm"
        autoFocus
        value={draft}
        isInvalid={invalid}
        style={{ maxWidth: 220 }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <Button
        size="sm"
        variant="primary"
        disabled={invalid}
        title={invalid && trimmed ? t("setupName.taken") : t("setupName.save")}
        aria-label={t("setupName.saveAria")}
        onClick={save}
      >
        <FontAwesomeIcon icon={faCheck} />
      </Button>
      <Button
        size="sm"
        variant="secondary"
        title={t("common.cancel")}
        aria-label={t("setupName.cancelAria")}
        onClick={() => setDraft(null)}
      >
        <FontAwesomeIcon icon={faXmark} />
      </Button>
    </span>
  );
};
