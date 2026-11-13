import { useState } from "react";
import { Nav } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import type { SetupParam } from "../../shared/types";
import { localizeSetupName } from "../../shared/setup-labels";
import { ParamTable } from "./SetupTabsCommon";

const TAB_ORDER = [
  "General",
  "Front",
  "Rear",
  "Electronics",
  "Transmission",
  "Steering",
] as const;
type TabId = (typeof TAB_ORDER)[number];

type Section =
  | "shared"
  | "left"
  | "right"
  | "abs_front"
  | "abs_rear"
  | "tc_cut"
  | "tc_slip"
  | "tc_lat"
  | "engine"
  | "gears"
  | "diff"
  | "hybrid"
  | "default";

const getTab = (p: SetupParam): TabId => {
  const { category, parameter } = p;
  if (category === "Steering") return "Steering";
  if (category === "ABS" || category === "Traction Control")
    return "Electronics";
  if (
    category === "Engine" ||
    category === "Transmission" ||
    category === "Differential" ||
    category === "Hybrid"
  )
    return "Transmission";
  if (category === "Brakes" || category === "Fuel") return "General";
  if (category === "Tyres" && parameter.includes("Compound")) return "General";
  if (parameter.includes("Front")) return "Front";
  if (parameter.includes("Rear")) return "Rear";
  if (category === "Aero") return "Front"; // Splitter (no axle suffix)
  return "General";
};

const getSection = (p: SetupParam, tab: TabId): Section => {
  const { category, parameter } = p;
  if (tab === "Front" || tab === "Rear") {
    if (/Left/.test(parameter)) return "left";
    if (/Right/.test(parameter)) return "right";
    return "shared";
  }
  if (tab === "Electronics") {
    if (category === "ABS" && /Front/.test(parameter)) return "abs_front";
    if (category === "ABS" && /Rear/.test(parameter)) return "abs_rear";
    if (/Lat/.test(parameter)) return "tc_lat";
    if (/Slip/.test(parameter)) return "tc_slip";
    return "tc_cut";
  }
  if (tab === "Transmission") {
    if (category === "Engine") return "engine";
    if (category === "Transmission") return "gears";
    if (category === "Differential") return "diff";
    if (category === "Hybrid") return "hybrid";
  }
  return "default";
};

const cleanLabel = (parameter: string, section: Section): string => {
  switch (section) {
    case "left":
    case "right":
      return parameter.replace(/\s+(Front|Rear)\s+(Left|Right)/i, "").trim();
    case "shared":
      return parameter.replace(/\s+(Front|Rear)$/i, "").trim();
    case "abs_front":
    case "abs_rear":
      return parameter
        .replace(/ABS\s+Slip\s+(Front|Rear)\s+Preset\s+/i, "Preset ")
        .trim();
    case "tc_cut":
      return parameter.replace(/Tc\s+Preset\s+/i, "Preset ").trim();
    case "tc_slip":
      return parameter.replace(/Tc\s+Slip\s+Preset\s+/i, "Preset ").trim();
    case "tc_lat":
      return parameter.replace(/Tc\s+Lat\s+Preset\s+/i, "Preset ").trim();
    default:
      return parameter;
  }
};

const SimpleTab = ({ params }: { params: SetupParam[] }) => {
  return (
    <ParamTable
      rows={params.map((p) => ({ label: p.parameter, value: p.value }))}
    />
  );
};

const AxleTab = ({
  params,
  axle,
}: {
  params: SetupParam[];
  axle: "Front" | "Rear";
}) => {
  const { t } = useTranslation();
  const wheels =
    axle === "Front" ? (["FL", "FR"] as const) : (["RL", "RR"] as const);
  const shared = params.filter((p) => getSection(p, axle) === "shared");
  const left = params.filter((p) => getSection(p, axle) === "left");
  const right = params.filter((p) => getSection(p, axle) === "right");
  return (
    <div>
      {shared.length > 0 && (
        <div className="mb-2">
          <div className="setup-subsection-title">{t("setup.tab.shared")}</div>
          <ParamTable
            rows={shared.map((p) => ({
              label: cleanLabel(p.parameter, "shared"),
              value: p.value,
            }))}
          />
        </div>
      )}
      <div className="d-flex gap-2">
        {left.length > 0 && (
          <div className="setup-axle-col">
            <div className="setup-subsection-title">
              {t(`setup.wheelShort.${wheels[0]}`)}
            </div>
            <ParamTable
              rows={left.map((p) => ({
                label: cleanLabel(p.parameter, "left"),
                value: p.value,
              }))}
            />
          </div>
        )}
        {right.length > 0 && (
          <div className="setup-axle-col">
            <div className="setup-subsection-title">
              {t(`setup.wheelShort.${wheels[1]}`)}
            </div>
            <ParamTable
              rows={right.map((p) => ({
                label: cleanLabel(p.parameter, "right"),
                value: p.value,
              }))}
            />
          </div>
        )}
      </div>
    </div>
  );
};

type SectionTitle =
  | "setup.section.absFront"
  | "setup.section.absRear"
  | "setup.section.tcCut"
  | "setup.section.tcSlip"
  | "setup.section.tcLat";

const Section = ({
  title,
  rows,
}: {
  title: SectionTitle;
  rows: Array<{ label: string; value: string }>;
}) => {
  const { t } = useTranslation();
  return (
    <>
      <div className="setup-subsection-title">{t(title)}</div>
      <ParamTable rows={rows} />
    </>
  );
};

const ElectronicsTab = ({ params }: { params: SetupParam[] }) => {
  const absF = params.filter(
    (p) => getSection(p, "Electronics") === "abs_front",
  );
  const absR = params.filter(
    (p) => getSection(p, "Electronics") === "abs_rear",
  );
  const tcCut = params.filter((p) => getSection(p, "Electronics") === "tc_cut");
  const tcSlip = params.filter(
    (p) => getSection(p, "Electronics") === "tc_slip",
  );
  const tcLat = params.filter((p) => getSection(p, "Electronics") === "tc_lat");

  const absBoth = absF.length > 0 && absR.length > 0;
  const tcTypeCount = [tcCut, tcSlip, tcLat].filter((g) => g.length > 0).length;

  return (
    <div>
      {(absF.length > 0 || absR.length > 0) &&
        (absBoth ? (
          <div className="d-flex gap-2 mb-2">
            <div className="setup-axle-col">
              <Section
                title="setup.section.absFront"
                rows={absF.map((p) => ({
                  label: cleanLabel(p.parameter, "abs_front"),
                  value: p.value,
                }))}
              />
            </div>
            <div className="setup-axle-col">
              <Section
                title="setup.section.absRear"
                rows={absR.map((p) => ({
                  label: cleanLabel(p.parameter, "abs_rear"),
                  value: p.value,
                }))}
              />
            </div>
          </div>
        ) : (
          <div className="mb-2">
            {absF.length > 0 && (
              <Section
                title="setup.section.absFront"
                rows={absF.map((p) => ({
                  label: cleanLabel(p.parameter, "abs_front"),
                  value: p.value,
                }))}
              />
            )}
            {absR.length > 0 && (
              <Section
                title="setup.section.absRear"
                rows={absR.map((p) => ({
                  label: cleanLabel(p.parameter, "abs_rear"),
                  value: p.value,
                }))}
              />
            )}
          </div>
        ))}
      {tcTypeCount === 1 ? (
        <div className="mb-2">
          {tcCut.length > 0 && (
            <Section
              title="setup.section.tcCut"
              rows={tcCut.map((p) => ({
                label: cleanLabel(p.parameter, "tc_cut"),
                value: p.value,
              }))}
            />
          )}
          {tcSlip.length > 0 && (
            <Section
              title="setup.section.tcSlip"
              rows={tcSlip.map((p) => ({
                label: cleanLabel(p.parameter, "tc_slip"),
                value: p.value,
              }))}
            />
          )}
          {tcLat.length > 0 && (
            <Section
              title="setup.section.tcLat"
              rows={tcLat.map((p) => ({
                label: cleanLabel(p.parameter, "tc_lat"),
                value: p.value,
              }))}
            />
          )}
        </div>
      ) : tcTypeCount > 1 ? (
        <>
          {(tcCut.length > 0 || tcSlip.length > 0) && (
            <div className="d-flex gap-2 mb-2">
              {tcCut.length > 0 && (
                <div className="setup-axle-col">
                  <Section
                    title="setup.section.tcCut"
                    rows={tcCut.map((p) => ({
                      label: cleanLabel(p.parameter, "tc_cut"),
                      value: p.value,
                    }))}
                  />
                </div>
              )}
              {tcSlip.length > 0 && (
                <div className="setup-axle-col">
                  <Section
                    title="setup.section.tcSlip"
                    rows={tcSlip.map((p) => ({
                      label: cleanLabel(p.parameter, "tc_slip"),
                      value: p.value,
                    }))}
                  />
                </div>
              )}
            </div>
          )}
          {tcLat.length > 0 && (
            <div className="d-flex gap-2 mb-2">
              <div className="setup-axle-col">
                <Section
                  title="setup.section.tcLat"
                  rows={tcLat.map((p) => ({
                    label: cleanLabel(p.parameter, "tc_lat"),
                    value: p.value,
                  }))}
                />
              </div>
              <div className="setup-axle-col" />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

const TransmissionTab = ({ params }: { params: SetupParam[] }) => {
  const { t } = useTranslation();
  const engine = params.filter(
    (p) => getSection(p, "Transmission") === "engine",
  );
  const gears = params.filter((p) => getSection(p, "Transmission") === "gears");
  const diff = params.filter((p) => getSection(p, "Transmission") === "diff");
  const hybrid = params.filter(
    (p) => getSection(p, "Transmission") === "hybrid",
  );
  return (
    <div>
      {engine.length > 0 && (
        <div className="mb-2">
          <div className="setup-subsection-title">
            {localizeSetupName(t, "Engine")}
          </div>
          <ParamTable
            rows={engine.map((p) => ({ label: p.parameter, value: p.value }))}
          />
        </div>
      )}
      {gears.length > 0 && (
        <div className="mb-2">
          <div className="setup-subsection-title">
            {t("setup.section.gears")}
          </div>
          <ParamTable
            rows={gears.map((p) => ({ label: p.parameter, value: p.value }))}
          />
        </div>
      )}
      {diff.length > 0 && (
        <div className="mb-2">
          <div className="setup-subsection-title">
            {localizeSetupName(t, "Differential")}
          </div>
          <ParamTable
            rows={diff.map((p) => ({ label: p.parameter, value: p.value }))}
          />
        </div>
      )}
      {hybrid.length > 0 && (
        <div className="mb-2">
          <div className="setup-subsection-title">
            {localizeSetupName(t, "Hybrid")}
          </div>
          <ParamTable
            rows={hybrid.map((p) => ({ label: p.parameter, value: p.value }))}
          />
        </div>
      )}
    </div>
  );
};

const R3eSetupTabs = ({ params }: { params: SetupParam[] }) => {
  const { t } = useTranslation();
  const byTab: Partial<Record<TabId, SetupParam[]>> = {};
  for (const p of params) {
    const tab = getTab(p);
    if (!byTab[tab]) byTab[tab] = [];
    byTab[tab]!.push(p);
  }

  const available = TAB_ORDER.filter((t) => (byTab[t]?.length ?? 0) > 0);
  const [active, setActive] = useState<TabId>(() => available[0] ?? "General");

  if (available.length === 0) return null;

  return (
    <div>
      <Nav
        variant="tabs"
        className="setup-nav-tabs mb-2"
        activeKey={active}
        onSelect={(k) => k && setActive(k as TabId)}
      >
        {available.map((tab) => (
          <Nav.Item key={tab}>
            <Nav.Link eventKey={tab}>{localizeSetupName(t, tab)}</Nav.Link>
          </Nav.Item>
        ))}
      </Nav>
      <div className="setup-tab-body">
        {active === "General" && <SimpleTab params={byTab["General"] ?? []} />}
        {active === "Front" && (
          <AxleTab params={byTab["Front"] ?? []} axle="Front" />
        )}
        {active === "Rear" && (
          <AxleTab params={byTab["Rear"] ?? []} axle="Rear" />
        )}
        {active === "Electronics" && (
          <ElectronicsTab params={byTab["Electronics"] ?? []} />
        )}
        {active === "Transmission" && (
          <TransmissionTab params={byTab["Transmission"] ?? []} />
        )}
        {active === "Steering" && (
          <SimpleTab params={byTab["Steering"] ?? []} />
        )}
      </div>
    </div>
  );
};

export default R3eSetupTabs;
