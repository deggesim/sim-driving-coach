/**
 * TitleBar - Custom frameless window title bar with tabs and window controls.
 * Used in Electron frameless mode for drag area and window management.
 */

import { Button } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { useLayoutStore } from "../store/layoutStore";
import { useSettingsStore } from "../store/settingsStore";
import { LanguageMenu } from "./LanguageMenu";
import iconUrl from "/icon.png";

type Tab = "current-session" | "session-list" | "settings" | "guide";

interface TitleBarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
}

const TitleBar = ({ tab, onTabChange }: TitleBarProps) => {
  const { t } = useTranslation();
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const setTtsEnabled = useSettingsStore((s) => s.setTtsEnabled);
  const showCost = useSettingsStore((s) => s.showCost);
  const setShowCost = useSettingsStore((s) => s.setShowCost);
  const layout = useLayoutStore((s) => s.layout);
  const setLayout = useLayoutStore((s) => s.setLayout);
  return (
    <div className="title-bar text-nowrap">
      <img src={iconUrl} className="title-bar-icon" alt="" />
      <span className="title-bar-name">Sim Driving Coach</span>
      <div className="title-bar-tabs">
        <Button
          variant="link"
          className={`tab-btn ${tab === "current-session" ? "active" : ""}`}
          aria-current={tab === "current-session" ? "page" : undefined}
          onClick={() => onTabChange("current-session")}
        >
          {t("titleBar.live")}
        </Button>
        <Button
          variant="link"
          className={`tab-btn ${tab === "session-list" ? "active" : ""}`}
          aria-current={tab === "session-list" ? "page" : undefined}
          onClick={() => onTabChange("session-list")}
        >
          {t("titleBar.sessions")}
        </Button>
        <Button
          variant="link"
          className={`tab-btn ${tab === "settings" ? "active" : ""}`}
          aria-current={tab === "settings" ? "page" : undefined}
          onClick={() => onTabChange("settings")}
        >
          {t("titleBar.settings")}
        </Button>
        <Button
          variant="link"
          className={`tab-btn ${tab === "guide" ? "active" : ""}`}
          aria-current={tab === "guide" ? "page" : undefined}
          onClick={() => onTabChange("guide")}
        >
          {t("titleBar.guide")}
        </Button>
      </div>
      <div className="title-bar-tts">
        {(["columns", "rows"] as const).map((l) => (
          <Button
            key={l}
            variant="link"
            className={`tts-toggle ${layout === l ? "on" : "off"}`}
            onClick={() => setLayout(l)}
            title={t(
              l === "columns"
                ? "titleBar.layoutColumns"
                : "titleBar.layoutRows",
            )}
            aria-label={t(
              l === "columns"
                ? "titleBar.layoutColumns"
                : "titleBar.layoutRows",
            )}
            aria-pressed={layout === l}
          >
            <i
              className={`bi bi-${l === "rows" ? "hr" : "vr"}`}
              aria-hidden
            />
          </Button>
        ))}
        <Button
          variant="link"
          className={`tts-toggle ${showCost ? "on" : "off"}`}
          onClick={() => setShowCost(!showCost)}
          title={t("titleBar.cost")}
          aria-label={t("titleBar.cost")}
          aria-pressed={showCost}
        >
          <i className="bi bi-currency-dollar" aria-hidden />
        </Button>
        <Button
          variant="link"
          className={`tts-toggle ${ttsEnabled ? "on" : "off"}`}
          onClick={() => setTtsEnabled(!ttsEnabled)}
          title={ttsEnabled ? t("titleBar.voiceOn") : t("titleBar.voiceOff")}
          aria-label={t("titleBar.voice")}
          aria-pressed={ttsEnabled}
        >
          {ttsEnabled ? (
            <i className="bi bi-mic-fill" aria-hidden />
          ) : (
            <i className="bi bi-mic-mute-fill" aria-hidden />
          )}
        </Button>
      </div>
      <LanguageMenu />
      <Button
        variant="link"
        className="title-bar-wc"
        onClick={() => window.electronAPI.windowMinimize()}
        title={t("titleBar.minimize")}
        aria-label={t("titleBar.minimize")}
      >
        <i className="bi bi-dash-lg" aria-hidden />
      </Button>
      <Button
        variant="link"
        className="title-bar-wc"
        onClick={() => window.electronAPI.windowMaximize()}
        title={t("titleBar.maximize")}
        aria-label={t("titleBar.maximizeLabel")}
      >
        <i className="bi bi-fullscreen" aria-hidden />
      </Button>
      <Button
        variant="link"
        className="title-bar-close"
        onClick={() => window.electronAPI.windowClose()}
        title={t("titleBar.close")}
        aria-label={t("titleBar.closeLabel")}
      >
        <i className="bi bi-x-lg" aria-hidden />
      </Button>
    </div>
  );
};

export default TitleBar;
