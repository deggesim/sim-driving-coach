import { Accordion, Container } from "react-bootstrap";
import { Trans, useTranslation } from "react-i18next";

const GUIDE_SECTIONS = [
  "prerequisites",
  "accounts",
  "session",
  "driving",
  "setup",
  "voice",
  "analysis",
  "history",
] as const;

// target="_blank" is redirected to the system browser by main's window-open handler.
const link = (href: string) => (
  <a href={href} target="_blank" rel="noreferrer" />
);

const GUIDE_COMPONENTS = {
  b: <b />,
  code: <code />,
  i: <i />,
  keys: link("https://platform.claude.com/settings/keys"),
  anthropic: link("https://platform.claude.com"),
  azure: link("https://azure.microsoft.com"),
  portal: link("https://portal.azure.com"),
};

const GuidePanel = () => {
  const { t } = useTranslation("guide");

  return (
    <Container fluid className="guide-panel h-100 p-4">
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
                  {(Array.isArray(steps) ? steps : []).map((step, n) => (
                    <li key={String(step)} className="mb-2">
                      <Trans
                        t={t}
                        i18nKey={`sections.${id}.steps.${n}`}
                        components={GUIDE_COMPONENTS}
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
