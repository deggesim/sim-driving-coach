/* eslint-disable react-refresh/only-export-components */
import { useTranslation } from "react-i18next";
import type { SetupParam } from "../../shared/types";
import { localizeSetupName } from "../../shared/setup-labels";

export const WHEEL_KEYS = ["FL", "FR", "RL", "RR"] as const;
export type WheelKey = (typeof WHEEL_KEYS)[number];

export const getWheelKey = (parameter: string): WheelKey | null => {
  for (const key of WHEEL_KEYS) {
    if (new RegExp(`\\s${key}(\\s|$)`).test(parameter)) return key;
  }
  return null;
};

export const stripWheelSuffix = (parameter: string): string =>
  parameter.replace(/\s+(FL|FR|RL|RR)(?=\s|$)/, "").trim();

export const ParamTable = ({
  rows,
}: {
  rows: Array<{ label: string; value: string }>;
}) => {
  const { t } = useTranslation();
  return (
    <table className="setup-tab-table w-100">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="text-muted">{localizeSetupName(t, r.label)}</td>
            <td className="setup-value">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const FourCornerGrid = ({ params }: { params: SetupParam[] }) => {
  const { t } = useTranslation();
  const byWheel: Partial<Record<WheelKey, SetupParam[]>> = {};
  const shared: SetupParam[] = [];

  for (const p of params) {
    const key = getWheelKey(p.parameter);
    if (key) {
      if (!byWheel[key]) byWheel[key] = [];
      byWheel[key]!.push(p);
    } else {
      shared.push(p);
    }
  }

  const rows: [WheelKey, WheelKey][] = [
    ["FL", "FR"],
    ["RL", "RR"],
  ];

  return (
    <div>
      {rows.map(([left, right]) => (
        <div key={left} className="d-flex gap-2 mb-2">
          {([left, right] as WheelKey[]).map((key) => (
            <div key={key} className="setup-axle-col">
              <div className="setup-subsection-title">
                {t(`setup.wheelShort.${key}`)}
              </div>
              <ParamTable
                rows={(byWheel[key] ?? []).map((p) => ({
                  label: stripWheelSuffix(p.parameter),
                  value: p.value,
                }))}
              />
            </div>
          ))}
        </div>
      ))}
      {shared.length > 0 && (
        <ParamTable
          rows={shared.map((p) => ({ label: p.parameter, value: p.value }))}
        />
      )}
    </div>
  );
};
