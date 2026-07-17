import { useState } from "react";
import { Nav } from "react-bootstrap";
import type { SetupParam } from "../../shared/types";
import { ParamTable, FourCornerGrid } from "./SetupTabsCommon";
import {
  AMS2_TABS,
  TAB_SECTIONS,
  GRID_SECTIONS,
  sectionForCategory,
  type Ams2Tab,
  type Ams2Section,
} from "./ams2-setup-sections";

const Ams2SetupTabs = ({ params }: { params: SetupParam[] }) => {
  const bySection: Partial<Record<Ams2Section, SetupParam[]>> = {};
  for (const p of params) {
    const section = sectionForCategory(p.category);
    (bySection[section] ??= []).push(p);
  }

  const tabHasParams = (tab: Ams2Tab): boolean =>
    TAB_SECTIONS[tab].some((s) => (bySection[s]?.length ?? 0) > 0);

  const availableTabs = AMS2_TABS.filter(tabHasParams);
  const [active, setActive] = useState<Ams2Tab>(
    () => availableTabs[0] ?? AMS2_TABS[0],
  );

  if (availableTabs.length === 0) return null;

  const activeTab = availableTabs.includes(active) ? active : availableTabs[0];

  return (
    <div>
      <Nav
        variant="tabs"
        className="setup-nav-tabs mb-2"
        activeKey={activeTab}
        onSelect={(k) => k && setActive(k as Ams2Tab)}
      >
        {availableTabs.map((t) => (
          <Nav.Item key={t}>
            <Nav.Link eventKey={t}>{t}</Nav.Link>
          </Nav.Item>
        ))}
      </Nav>
      <div className="setup-tab-body">
        {TAB_SECTIONS[activeTab]
          .filter((s) => (bySection[s]?.length ?? 0) > 0)
          .map((section) => {
            const sectionParams = bySection[section] ?? [];
            return (
              <div key={section} className="mb-3">
                <div className="setup-subsection-title">{section}</div>
                {GRID_SECTIONS.has(section) ? (
                  <FourCornerGrid params={sectionParams} />
                ) : (
                  <ParamTable
                    rows={sectionParams.map((p) => ({
                      label: p.parameter,
                      value: p.value,
                    }))}
                  />
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default Ams2SetupTabs;
