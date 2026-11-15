import { Accordion, Container } from "react-bootstrap";
import { Trans, useTranslation } from "react-i18next";

const GUIDE_SECTIONS = [
  "prerequisites",
  "session",
  "driving",
  "setup",
  "voice",
  "analysis",
  "history",
] as const;

const GuidePanel = () => {
  const { t } = useTranslation("guide");

  return (
    <Container fluid className="guide-panel p-4">
      <h2 className="fs-5 fw-bold mb-2">{t("title")}</h2>
      <p className="text-secondary mb-4">{t("intro")}</p>
      <Accordion defaultActiveKey={GUIDE_SECTIONS[0]}>
        {GUIDE_SECTIONS.map((id, i) => {
          // A missing key makes t() return a string: render no steps, not a crash.
          const steps = t(`sections.${id}.steps`, { returnObjects: true });
          return (
            <Accordion.Item key={id} eventKey={id}>
              <Accordion.Header>
                {i + 1}. {t(`sections.${id}.title`)}
              </Accordion.Header>
              <Accordion.Body>
                <ol className="mb-0">
                  {(Array.isArray(steps) ? steps : []).map((_, n) => (
                    <li key={`${id}-${n}`} className="mb-2">
                      <Trans
                        t={t}
                        i18nKey={`sections.${id}.steps.${n}`}
                        components={{ b: <b />, code: <code /> }}
                      />
                    </li>
                  ))}
                </ol>
              </Accordion.Body>
            </Accordion.Item>
          );
        })}
      </Accordion>
    </Container>
  );
};

export default GuidePanel;
