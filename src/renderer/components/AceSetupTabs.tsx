import { useState } from "react";
import { Nav } from "react-bootstrap";
import type { SetupParam } from "../../shared/types";
import { ParamTable, FourCornerGrid, getWheelKey } from "./SetupTabsCommon";

const ACE_TAB_ORDER = [
  "Tyres",
  "Electronics",
  "Fuel and Strategy",
  "Suspension",
  "Dampers",
  "Aero",
] as const;
type AceTabId = (typeof ACE_TAB_ORDER)[number];

const getAceTab = (p: SetupParam): AceTabId => {
  switch (p.category) {
    case "Tyres":
    case "Geometry":
      return "Tyres";
    case "Electronics":
      return "Electronics";
    case "Fuel":
      return "Fuel and Strategy";
    case "Suspension":
    case "Steering":
    case "Brakes":
      return "Suspension";
    case "Dampers":
      return "Dampers";
    default:
      return "Aero";
  }
};

const SuspensionTab = ({ params }: { params: SetupParam[] }) => {
  const firstCornerIdx = params.findIndex(
    (p) => getWheelKey(p.parameter) !== null,
  );
  const lastCornerIdx = params.reduce(
    (acc, p, i) => (getWheelKey(p.parameter) !== null ? i : acc),
    -1,
  );

  const sharedTop = firstCornerIdx > 0 ? params.slice(0, firstCornerIdx) : [];
  const cornerBlock =
    firstCornerIdx >= 0 ? params.slice(firstCornerIdx, lastCornerIdx + 1) : [];
  const sharedBottom =
    lastCornerIdx >= 0 && lastCornerIdx < params.length - 1
      ? params.slice(lastCornerIdx + 1)
      : [];

  return (
    <div>
      {sharedTop.length > 0 && (
        <div className="mb-2">
          <ParamTable
            rows={sharedTop.map((p) => ({
              label: p.parameter,
              value: p.value,
            }))}
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
};

const AceSetupTabs = ({ params }: { params: SetupParam[] }) => {
  const byTab: Partial<Record<AceTabId, SetupParam[]>> = {};
  for (const p of params) {
    const tab = getAceTab(p);
    if (!byTab[tab]) byTab[tab] = [];
    byTab[tab]!.push(p);
  }

  const available = ACE_TAB_ORDER.filter((t) => (byTab[t]?.length ?? 0) > 0);
  const [active, setActive] = useState<AceTabId>(() => available[0] ?? "Tyres");

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
        {active === "Tyres" && <FourCornerGrid params={byTab["Tyres"] ?? []} />}
        {active === "Electronics" && (
          <ParamTable rows={flatRows("Electronics")} />
        )}
        {active === "Fuel and Strategy" && (
          <ParamTable rows={flatRows("Fuel and Strategy")} />
        )}
        {active === "Suspension" && (
          <SuspensionTab params={byTab["Suspension"] ?? []} />
        )}
        {active === "Dampers" && (
          <FourCornerGrid params={byTab["Dampers"] ?? []} />
        )}
        {active === "Aero" && <ParamTable rows={flatRows("Aero")} />}
      </div>
    </div>
  );
};

export default AceSetupTabs;
