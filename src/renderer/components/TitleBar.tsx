/**
 * TitleBar - Custom frameless window title bar with tabs and window controls.
 * Used in Electron frameless mode for drag area and window management.
 */

import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMicrophone,
  faMicrophoneSlash,
  faMinus,
  faExpand,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { useTranslation } from "react-i18next";
import { LanguageMenu } from "./LanguageMenu";
import { useSettingsStore } from "../store/settingsStore";
import iconUrl from "/icon.png";

type Tab = "current-session" | "session-list" | "settings";

interface TitleBarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
}

const TitleBar = ({ tab, onTabChange }: TitleBarProps) => {
  const { t } = useTranslation();
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const setTtsEnabled = useSettingsStore((s) => s.setTtsEnabled);
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
      </div>
      <div className="title-bar-tts">
        <Button
          variant="link"
          className={`tts-toggle ${ttsEnabled ? "on" : "off"}`}
          onClick={() => setTtsEnabled(!ttsEnabled)}
          title={ttsEnabled ? t("titleBar.voiceOn") : t("titleBar.voiceOff")}
          aria-label={t("titleBar.voice")}
          aria-pressed={ttsEnabled}
        >
          {ttsEnabled ? (
            <FontAwesomeIcon icon={faMicrophone} />
          ) : (
            <FontAwesomeIcon icon={faMicrophoneSlash} />
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
        <FontAwesomeIcon icon={faMinus} />
      </Button>
      <Button
        variant="link"
        className="title-bar-wc"
        onClick={() => window.electronAPI.windowMaximize()}
        title={t("titleBar.maximize")}
        aria-label={t("titleBar.maximizeLabel")}
      >
        <FontAwesomeIcon icon={faExpand} />
      </Button>
      <Button
        variant="link"
        className="title-bar-close"
        onClick={() => window.electronAPI.windowClose()}
        title={t("titleBar.close")}
        aria-label={t("titleBar.closeLabel")}
      >
        <FontAwesomeIcon icon={faXmark} />
      </Button>
    </div>
  );
};

export default TitleBar;
