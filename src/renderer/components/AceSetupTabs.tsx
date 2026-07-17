import { useState } from "react";
import { Nav } from "react-bootstrap";
import type { SetupParam } from "../../shared/types";
import { ParamTable, FourCornerGrid, getWheelKey } from "./SetupTabsCommon";

const ACE_TAB_ORDER = [
  "Pneumatici",
  "Elettronica",
  "Carburante e Strategia",
  "Sospensioni",
  "Ammortizzatori",
  "Aerodinamica",
] as const;
type AceTabId = (typeof ACE_TAB_ORDER)[number];

const getAceTab = (p: SetupParam): AceTabId => {
  switch (p.category) {
    case "Pneumatici":
    case "Geometria":
      return "Pneumatici";
    case "Elettronica":
      return "Elettronica";
    case "Carburante":
    case "Identificazione":
      return "Carburante e Strategia";
    case "Sospensioni":
    case "Sterzo":
    case "Freni":
      return "Sospensioni";
    case "Ammortizzatori":
      return "Ammortizzatori";
    case "Aerodinamica":
    case "Assetto":
      return "Aerodinamica";
    default:
      return "Aerodinamica";
  }
};

const SuspensionTab = ({ params }: { params: SetupParam[] }) => {
  const firstCornerIdx = params.findIndex((p) => getWheelKey(p.parameter) !== null);
  const lastCornerIdx = params.reduce(
    (acc, p, i) => (getWheelKey(p.parameter) !== null ? i : acc),
    -1,
  );

  const sharedTop =
    firstCornerIdx > 0 ? params.slice(0, firstCornerIdx) : [];
  const cornerBlock =
    firstCornerIdx >= 0
      ? params.slice(firstCornerIdx, lastCornerIdx + 1)
      : [];
  const sharedBottom =
    lastCornerIdx >= 0 && lastCornerIdx < params.length - 1
      ? params.slice(lastCornerIdx + 1)
      : [];

  return (
    <div>
      {sharedTop.length > 0 && (
        <div className="mb-2">
          <ParamTable
            rows={sharedTop.map((p) => ({ label: p.parameter, value: p.value }))}
          />
        </div>
      )}
      {cornerBlock.length > 0 && (
        <div className="mb-2">
          <FourCornerGrid params={cornerBlock} />
        </div>
      )}
      {sharedBottom.length > 0 && (
        <div className="mb-2">
          <ParamTable
            rows={sharedBottom.map((p) => ({
              label: p.parameter,
              value: p.value,
            }))}
          />
        </div>
      )}
    </div>
  );
}

const AceSetupTabs = ({ params }: { params: SetupParam[] }) => {
  const byTab: Partial<Record<AceTabId, SetupParam[]>> = {};
  for (const p of params) {
    const tab = getAceTab(p);
    if (!byTab[tab]) byTab[tab] = [];
    byTab[tab]!.push(p);
  }

  const available = ACE_TAB_ORDER.filter((t) => (byTab[t]?.length ?? 0) > 0);
  const [active, setActive] = useState<AceTabId>(
    () => available[0] ?? "Pneumatici",
  );

  if (available.length === 0) return null;

  const flatRows = (tab: AceTabId) =>
    (byTab[tab] ?? []).map((p) => ({ label: p.parameter, value: p.value }));

  return (
    <div>
      <Nav
        variant="tabs"
        className="setup-nav-tabs mb-2"
        activeKey={active}
        onSelect={(k) => k && setActive(k as AceTabId)}
      >
        {available.map((t) => (
          <Nav.Item key={t}>
            <Nav.Link eventKey={t}>{t}</Nav.Link>
          </Nav.Item>
        ))}
      </Nav>
      <div className="setup-tab-body">
        {active === "Pneumatici" && (
          <FourCornerGrid params={byTab["Pneumatici"] ?? []} />
        )}
        {active === "Elettronica" && (
          <ParamTable rows={flatRows("Elettronica")} />
        )}
        {active === "Carburante e Strategia" && (
          <ParamTable rows={flatRows("Carburante e Strategia")} />
        )}
        {active === "Sospensioni" && (
          <SuspensionTab params={byTab["Sospensioni"] ?? []} />
        )}
        {active === "Ammortizzatori" && (
          <FourCornerGrid params={byTab["Ammortizzatori"] ?? []} />
        )}
        {active === "Aerodinamica" && (
          <ParamTable rows={flatRows("Aerodinamica")} />
        )}
      </div>
    </div>
  );
};

export default AceSetupTabs;
