import { UPDATE_MOCK_EVENT } from "./UpdateModals";
import { useEffect, useCallback, useState, useRef } from "react";
import {
  Button,
  Form,
  Spinner,
  Container,
  Row,
  Col,
  Badge,
  Alert,
} from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { useConfig } from "../hooks/useIPC";
import { useIPCStore } from "../store/ipcStore";
import { useSettingsStore } from "../store/settingsStore";
import type { AzureVoice, AnthropicModelInfo } from "../../shared/types";
import { assistantIntro } from "../../shared/format";

const AZURE_REGIONS = [
  { value: "australiacentral", label: "Australia Central" },
  { value: "australiacentral2", label: "Australia Central 2" },
  { value: "australiaeast", label: "Australia East" },
  { value: "australiasoutheast", label: "Australia Southeast" },
  { value: "austriaeast", label: "Austria East" },
  { value: "belgiocentral", label: "Belgium Central" },
  { value: "brazilsouth", label: "Brazil South" },
  { value: "brazilsoutheast", label: "Brazil Southeast" },
  { value: "canadacentral", label: "Canada Central" },
  { value: "canadaeast", label: "Canada East" },
  { value: "centralindia", label: "Central India" },
  { value: "centralus", label: "Central US" },
  { value: "chilecentral", label: "Chile Central" },
  { value: "denmarkeast", label: "Denmark East" },
  { value: "eastasia", label: "East Asia" },
  { value: "eastus", label: "East US" },
  { value: "eastus2", label: "East US 2" },
  { value: "francecentral", label: "France Central" },
  { value: "francesouth", label: "France South" },
  { value: "germanynorth", label: "Germany North" },
  { value: "germanywestcentral", label: "Germany West Central" },
  { value: "indonesiacentral", label: "Indonesia Central" },
  { value: "israelcentral", label: "Israel Central" },
  { value: "italynorth", label: "Italy North" },
  { value: "japaneast", label: "Japan East" },
  { value: "japanwest", label: "Japan West" },
  { value: "koreacentral", label: "Korea Central" },
  { value: "koreasouth", label: "Korea South" },
  { value: "malaysiawest", label: "Malaysia West" },
  { value: "mexicocentral", label: "Mexico Central" },
  { value: "newzealandnorth", label: "New Zealand North" },
  { value: "northcentralus", label: "North Central US" },
  { value: "northeurope", label: "North Europe" },
  { value: "norwayeast", label: "Norway East" },
  { value: "norwaywest", label: "Norway West" },
  { value: "polandcentral", label: "Poland Central" },
  { value: "qatarcentral", label: "Qatar Central" },
  { value: "southafricanorth", label: "South Africa North" },
  { value: "southafricawest", label: "South Africa West" },
  { value: "southcentralus", label: "South Central US" },
  { value: "southindia", label: "South India" },
  { value: "southeastasia", label: "Southeast Asia" },
  { value: "spaincentral", label: "Spain Central" },
  { value: "swedencentral", label: "Sweden Central" },
  { value: "switzerlandnorth", label: "Switzerland North" },
  { value: "switzerlandwest", label: "Switzerland West" },
  { value: "uaecentral", label: "UAE Central" },
  { value: "uaenorth", label: "UAE North" },
  { value: "uksouth", label: "UK South" },
  { value: "ukwest", label: "UK West" },
  { value: "westcentralus", label: "West Central US" },
  { value: "westeurope", label: "West Europe" },
  { value: "westindia", label: "West India" },
  { value: "westus", label: "West US" },
  { value: "westus2", label: "West US 2" },
  { value: "westus3", label: "West US 3" },
];

const KEY_LABELS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "Enter",
  Escape: "Esc",
  Backspace: "⌫",
  Tab: "Tab",
  CapsLock: "Caps",
  Home: "Home",
  Insert: "Ins",
  PrintScreen: "PrtSc",
  ScrollLock: "ScrollLk",
  NumLock: "NumLk",
};

// Keys whose short label is language-specific.
const KEY_I18N = {
  Delete: "settings.keys.Delete",
  End: "settings.keys.End",
  PageUp: "settings.keys.PageUp",
  PageDown: "settings.keys.PageDown",
  Pause: "settings.keys.Pause",
} as const;

const formatKeyPart = (part: string, t: TFunction): string => {
  const i18nKey = KEY_I18N[part as keyof typeof KEY_I18N];
  if (i18nKey) return t(i18nKey);
  return KEY_LABELS[part] ?? (part.length === 1 ? part.toUpperCase() : part);
};

const KeyComboDisplay = ({ combo }: { combo: string }) => {
  const { t } = useTranslation();
  const parts = combo.split("+");
  return (
    <span className="d-inline-flex align-items-center gap-1">
      {parts.map((part, i) => (
        <span key={part} className="d-inline-flex align-items-center gap-1">
          <kbd
            style={{ fontSize: "0.8em", padding: "1px 5px", borderRadius: 3 }}
          >
            {formatKeyPart(part, t)}
          </kbd>
          {i < parts.length - 1 && (
            <span className="text-secondary" style={{ fontSize: "0.8em" }}>
              +
            </span>
          )}
        </span>
      ))}
    </span>
  );
};

const getButtonLabel = (index: number, t: TFunction): string => {
  const labels: Record<number, string> = {
    0: "A",
    1: "B",
    2: "X",
    3: "Y",
    4: "LB",
    5: "RB",
    6: "LT",
    7: "RT",
    8: "Select",
    9: "Start",
    10: "L3",
    11: "R3",
    12: t("settings.pad.up"),
    13: t("settings.pad.down"),
    14: t("settings.pad.left"),
    15: t("settings.pad.right"),
  };
  return labels[index] ?? t("settings.pad.button", { n: index });
};

const SettingsPanel = () => {
  const { t } = useTranslation();
  const frame = useIPCStore((s) => s.frame);

  const {
    apiKey,
    setApiKey,
    assistantName,
    setAssistantName,
    gamepadButton,
    setGamepadButton,
    keyboardVoiceKey,
    setKeyboardVoiceKey,
    setCapturingVoiceInput,
    anthropicModel,
    setAnthropicModel,
    anthropicModelDetail,
    setAnthropicModelDetail,
    ttsEnabled,
    setTtsEnabled,
    azureTtsEnabled,
    setAzureTtsEnabled,
    azureSpeechKey,
    setAzureSpeechKey,
    azureRegion,
    setAzureRegion,
    azureVoiceName,
    setAzureVoiceName,
    mockHistoryMode,
    setMockHistoryMode,
    telemetryLogEnabled,
    setTelemetryLogEnabled,
    aceSetupsPath,
    setAceSetupsPath,
    settingSaved,
    showSaved,
  } = useSettingsStore();

  const { set: configSet } = useConfig();

  const [azureVoices, setAzureVoices] = useState<AzureVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isCapturingButton, setIsCapturingButton] = useState(false);
  const [isCapturingKey, setIsCapturingKey] = useState(false);
  const [telemetryLogDir, setTelemetryLogDir] = useState<string | null>(null);
  const telemetryDirFetchedRef = useRef(false);

  // Live Claude model list, refreshed on mount (empty until loaded / on error).
  const [models, setModels] = useState<AnthropicModelInfo[]>([]);
  const [modelsError, setModelsError] = useState(false);
  useEffect(() => {
    window.electronAPI
      .anthropicListModels()
      .then(setModels)
      .catch((err) => {
        console.error("anthropicListModels failed:", err);
        setModelsError(true);
      });
  }, []);

  const reportSaveError = useCallback(
    (err: unknown) => {
      console.error("[SettingsPanel] configSet failed:", err);
      setSaveError(t("settings.saveError"));
    },
    [t],
  );

  // Writes config entries in order; false (with an inline alert) on failure so
  // callers show "Saved" only after a real save.
  const persist = useCallback(
    async (entries: [string, string][]): Promise<boolean> => {
      setSaveError("");
      try {
        for (const [key, value] of entries) await configSet(key, value);
        return true;
      } catch (err) {
        reportSaveError(err);
        return false;
      }
    },
    [configSet, reportSaveError],
  );

  // A saved model missing from the live list is obsolete (retired by Anthropic).
  const modelObsolete =
    models.length > 0 && !models.some((m) => m.id === anthropicModel);
  // Keep the obsolete model selectable so the dropdown still shows it.
  const modelOptions =
    models.length === 0
      ? [{ id: anthropicModel, display_name: anthropicModel }]
      : modelObsolete
        ? [
            {
              id: anthropicModel,
              display_name: `${anthropicModel} (${t("settings.model.obsoleteTag")})`,
            },
            ...models,
          ]
        : models;
  const modelOptionsSorted = [...modelOptions].sort((a, b) =>
    a.display_name.localeCompare(b.display_name),
  );
  // Same reason as modelOptions above: a saved detail model missing from the
  // list must stay selectable, or the select would display "Come modello base"
  // while a different model is actually persisted.
  const detailOptions =
    anthropicModelDetail &&
    !modelOptionsSorted.some((m) => m.id === anthropicModelDetail)
      ? [
          {
            id: anthropicModelDetail,
            display_name: `${anthropicModelDetail} (${t("settings.model.obsoleteTag")})`,
          },
          ...modelOptionsSorted,
        ]
      : modelOptionsSorted;

  const handleSaveApiKey = async () => {
    if (await persist([["anthropicApiKey", apiKey]])) showSaved("apiKey");
  };

  const handleSaveModel = async () => {
    if (await persist([["anthropicModel", anthropicModel]])) showSaved("model");
  };

  const handleSaveModelDetail = async () => {
    if (await persist([["anthropicModelDetail", anthropicModelDetail]]))
      showSaved("modelDetail");
  };

  const handleSaveAssistant = async () => {
    const ok = await persist([
      ["assistantName", assistantName],
      [
        "gamepadTriggerButton",
        gamepadButton !== null ? String(gamepadButton) : "",
      ],
    ]);
    if (ok) showSaved("assistant");
  };

  const handleSaveAceSetupsPath = async () => {
    if (await persist([["aceSetupsPath", aceSetupsPath]]))
      showSaved("aceSetupsPath");
  };

  const handleToggleTelemetry = async () => {
    const next = !telemetryLogEnabled;
    setTelemetryLogEnabled(next);
    if (!(await persist([["telemetryLogEnabled", String(next)]]))) {
      setTelemetryLogEnabled(!next);
      return;
    }
    if (next && !telemetryDirFetchedRef.current) {
      const dir = await window.electronAPI.telemetryLogGetDir();
      setTelemetryLogDir(dir);
      telemetryDirFetchedRef.current = true;
    }
  };

  const handleToggleAzure = async () => {
    const next = !azureTtsEnabled;
    setAzureTtsEnabled(next);
    if (!(await persist([["azureTtsEnabled", String(next)]])))
      setAzureTtsEnabled(!next);
  };

  const handleSaveAzureKey = async () => {
    const ok = await persist([
      ["azureSpeechKey", azureSpeechKey],
      ["azureRegion", azureRegion],
    ]);
    if (ok) showSaved("azureKey");
  };

  const handleLoadVoices = async () => {
    setVoicesLoading(true);
    setVoicesError("");
    try {
      if (
        !(await persist([
          ["azureSpeechKey", azureSpeechKey],
          ["azureRegion", azureRegion],
        ]))
      )
        return;
      const voices = await window.electronAPI.ttsGetVoices();
      setAzureVoices(voices);
      if (voices.length > 0 && !azureVoiceName) {
        setAzureVoiceName(voices[0].ShortName);
        await persist([["azureVoiceName", voices[0].ShortName]]);
      }
    } catch (err) {
      setVoicesError(
        err instanceof Error ? err.message : t("settings.azure.voicesError"),
      );
    } finally {
      setVoicesLoading(false);
    }
  };

  const handleVoiceChange = useCallback(
    async (shortName: string) => {
      setAzureVoiceName(shortName);
      setVoicesError("");
      if (!(await persist([["azureVoiceName", shortName]]))) return;
      try {
        const raw = await window.electronAPI.ttsTest(shortName);
        const bytes = new Uint8Array(
          Object.values(raw as unknown as Record<string, number>),
        );
        const ctx = new AudioContext();
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start(0);
        source.onended = () => ctx.close();
      } catch (err) {
        console.error("[SettingsPanel] Voice preview error:", err);
        setVoicesError(t("settings.azure.previewError"));
      }
    },
    [persist, setAzureVoiceName, t],
  );

  useEffect(() => {
    if (telemetryLogEnabled && !telemetryDirFetchedRef.current) {
      window.electronAPI
        .telemetryLogGetDir()
        .then((dir) => {
          setTelemetryLogDir(dir);
          telemetryDirFetchedRef.current = true;
        })
        .catch(console.error);
    }
  }, [telemetryLogEnabled]);

  useEffect(() => {
    if (!isCapturingButton) return;
    const id = setInterval(() => {
      const gamepads = navigator.getGamepads();
      for (const gp of gamepads) {
        if (!gp) continue;
        for (let i = 0; i < gp.buttons.length; i++) {
          if (gp.buttons[i]?.pressed) {
            setGamepadButton(i);
            configSet("gamepadTriggerButton", String(i)).catch(reportSaveError);
            setKeyboardVoiceKey(null);
            configSet("keyboardVoiceKey", "").catch(reportSaveError);
            showSaved("gamepadButton");
            setIsCapturingButton(false);
            setCapturingVoiceInput(false);
            return;
          }
        }
      }
    }, 50);
    return () => clearInterval(id);
  }, [
    isCapturingButton,
    setGamepadButton,
    setKeyboardVoiceKey,
    setCapturingVoiceInput,
    configSet,
    reportSaveError,
    showSaved,
  ]);

  useEffect(() => {
    if (!isCapturingKey) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      e.preventDefault();
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      // For single characters (e.g. "+", "@"), the character itself already
      // encodes the Shift state. Including "Shift" would produce combos like
      // "Shift++" which Electron's globalShortcut cannot register. Only add
      // the Shift modifier for named keys (e.g. "F1", "ArrowUp", "Enter").
      if (e.shiftKey && e.key.length > 1) parts.push("Shift");
      parts.push(e.key);
      console.log(
        `[SettingsPanel] Captured keyboard combo: ${parts.join("+")}`,
      );
      const combo = parts.join("+");
      setKeyboardVoiceKey(combo);
      configSet("keyboardVoiceKey", combo).catch(reportSaveError);
      setGamepadButton(null);
      configSet("gamepadTriggerButton", "").catch(reportSaveError);
      showSaved("keyboardKey");
      setIsCapturingKey(false);
      setCapturingVoiceInput(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    isCapturingKey,
    setKeyboardVoiceKey,
    setGamepadButton,
    setCapturingVoiceInput,
    configSet,
    reportSaveError,
    showSaved,
  ]);

  return (
    <Container fluid className="settings-panel h-100 p-4">
      <h2 className="fs-5 fw-bold mb-4">{t("settings.title")}</h2>

      {saveError && (
        <Alert variant="danger" dismissible onClose={() => setSaveError("")}>
          {saveError}
        </Alert>
      )}

      {/* Row 1: API Key + Azure TTS */}
      <Row className="mb-4 g-4">
        <Col md={6}>
          <div className="settings-section">
            <Form.Label className="setting-section-label">
              {t("settings.anthropic.title")}
            </Form.Label>

            <Form.Group as={Row} className="mb-2" controlId="api-key">
              <Form.Label column sm={3}>
                {t("settings.key")}
              </Form.Label>
              <Col sm={7}>
                <Form.Control
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                />
              </Col>
              <Col sm={2}>
                <Button variant="primary" onClick={handleSaveApiKey}>
                  {settingSaved === "apiKey" ? (
                    <>
                      <FontAwesomeIcon icon={faCheck} /> {t("settings.savedF")}
                    </>
                  ) : (
                    t("settings.save")
                  )}
                </Button>
              </Col>
            </Form.Group>
            <Row className="mb-3">
              <Col sm={{ span: 9, offset: 3 }}>
                <Form.Text>{t("settings.anthropic.hint")}</Form.Text>
              </Col>
            </Row>

            <Form.Group as={Row} className="mb-2" controlId="anthropic-model">
              <Form.Label column sm={3}>
                {t("settings.model.label")}
              </Form.Label>
              <Col sm={7}>
                <Form.Select
                  value={anthropicModel}
                  onChange={(e) => setAnthropicModel(e.target.value)}
                >
                  {modelOptionsSorted.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </Form.Select>
                {modelsError && (
                  <p className="text-danger mt-2 mb-0" role="alert">
                    {t("settings.model.error")}
                  </p>
                )}
                {modelObsolete && (
                  <Alert variant="warning" className="mt-2 mb-0 py-2">
                    <Trans
                      i18nKey="settings.model.obsolete"
                      values={{ model: anthropicModel }}
                      components={{ code: <code /> }}
                    />
                  </Alert>
                )}
              </Col>
              <Col sm={2}>
                <Button variant="primary" onClick={handleSaveModel}>
                  {settingSaved === "model" ? (
                    <>
                      <FontAwesomeIcon icon={faCheck} /> {t("settings.savedM")}
                    </>
                  ) : (
                    t("settings.save")
                  )}
                </Button>
              </Col>
            </Form.Group>
            <Row>
              <Col sm={{ span: 9, offset: 3 }}>
                <Form.Text>{t("settings.model.hint")}</Form.Text>
              </Col>
            </Row>

            <Form.Group
              as={Row}
              className="mb-2"
              controlId="anthropic-model-detail"
            >
              <Form.Label column sm={3}>
                {t("settings.modelDetail.label")}
              </Form.Label>
              <Col sm={7}>
                <Form.Select
                  value={anthropicModelDetail}
                  onChange={(e) => setAnthropicModelDetail(e.target.value)}
                >
                  <option value="">{t("settings.modelDetail.default")}</option>
                  {detailOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col sm={2}>
                <Button variant="primary" onClick={handleSaveModelDetail}>
                  {settingSaved === "modelDetail" ? (
                    <>
                      <FontAwesomeIcon icon={faCheck} /> {t("settings.savedM")}
                    </>
                  ) : (
                    t("settings.save")
                  )}
                </Button>
              </Col>
            </Form.Group>
            <Row>
              <Col sm={{ span: 9, offset: 3 }}>
                <Form.Text>{t("settings.modelDetail.hint")}</Form.Text>
              </Col>
            </Row>
          </div>
        </Col>

        <Col md={6}>
          <div className="settings-section">
            <Form.Label className="setting-section-label">
              {t("settings.azure.title")}
            </Form.Label>

            <Form.Group as={Row} className="mb-2">
              <Form.Label column sm={3}>
                {t("settings.azure.status")}
              </Form.Label>
              <Col sm={9} className="d-flex align-items-center">
                <Form.Check
                  type="switch"
                  id="azure-tts-toggle"
                  label={azureTtsEnabled ? t("settings.on") : t("settings.off")}
                  checked={azureTtsEnabled}
                  onChange={handleToggleAzure}
                />
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-2" controlId="azure-key">
              <Form.Label column sm={3}>
                {t("settings.key")}
              </Form.Label>
              <Col sm={7}>
                <Form.Control
                  type="password"
                  value={azureSpeechKey}
                  onChange={(e) => setAzureSpeechKey(e.target.value)}
                  placeholder={t("settings.azure.keyPlaceholder")}
                />
              </Col>
              <Col sm={2}>
                <Button variant="primary" onClick={handleSaveAzureKey}>
                  {settingSaved === "azureKey"
                    ? `✓ ${t("settings.savedF")}`
                    : t("settings.save")}
                </Button>
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-2" controlId="azure-region">
              <Form.Label column sm={3}>
                {t("settings.azure.region")}
              </Form.Label>
              <Col sm={9}>
                <Form.Select
                  value={azureRegion}
                  onChange={(e) => setAzureRegion(e.target.value)}
                >
                  {AZURE_REGIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Form.Select>
              </Col>
            </Form.Group>

            <Row className="mb-2">
              <Col sm={{ span: 9, offset: 3 }}>
                <Button
                  variant="secondary"
                  onClick={handleLoadVoices}
                  disabled={voicesLoading || !azureSpeechKey}
                >
                  {voicesLoading ? (
                    <>
                      <Spinner className="me-1" />
                      {t("settings.azure.loading")}
                    </>
                  ) : (
                    t("settings.azure.loadVoices")
                  )}
                </Button>
              </Col>
            </Row>

            {voicesError && (
              <Row className="mb-2">
                <Col sm={{ span: 9, offset: 3 }}>
                  <p className="text-danger mb-0" role="alert">
                    {voicesError}
                  </p>
                </Col>
              </Row>
            )}

            {azureVoices.length > 0 && (
              <Form.Group as={Row} className="mb-2" controlId="azure-voice">
                <Form.Label column sm={3}>
                  {t("settings.azure.voice")}
                </Form.Label>
                <Col sm={9}>
                  <Form.Select
                    value={azureVoiceName}
                    onChange={(e) => handleVoiceChange(e.target.value)}
                  >
                    {azureVoices.map((v) => (
                      <option key={v.ShortName} value={v.ShortName}>
                        {v.LocalName} ({v.Gender === "Female" ? "F" : "M"})
                      </option>
                    ))}
                  </Form.Select>
                </Col>
              </Form.Group>
            )}

            <Row>
              <Col sm={{ span: 9, offset: 3 }}>
                <Form.Text>
                  {t("settings.azure.hint", {
                    intro: assistantIntro(assistantName),
                  })}
                </Form.Text>
              </Col>
            </Row>
          </div>
        </Col>
      </Row>

      {/* Row 2: Assistente Vocale + Test & sviluppo */}
      <Row className="mb-4 g-4">
        <Col md={6}>
          <div className="settings-section">
            <Form.Label className="setting-section-label">
              {t("settings.assistant.title")}
            </Form.Label>

            <Form.Group as={Row} className="mb-2" controlId="assistant-name">
              <Form.Label column sm={3}>
                {t("settings.assistant.name")}
              </Form.Label>
              <Col sm={5}>
                <Form.Control
                  type="text"
                  value={assistantName}
                  onChange={(e) => setAssistantName(e.target.value)}
                  placeholder="Aria"
                  maxLength={16}
                />
              </Col>
              <Col sm={2}>
                <Button variant="primary" onClick={handleSaveAssistant}>
                  {settingSaved === "assistant" ? (
                    <>
                      <FontAwesomeIcon icon={faCheck} /> {t("settings.savedM")}
                    </>
                  ) : (
                    t("settings.save")
                  )}
                </Button>
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-2">
              <Form.Label column sm={3}>
                {t("settings.controller.label")}
              </Form.Label>
              <Col sm={9} className="d-flex align-items-center gap-2 flex-wrap">
                {isCapturingButton ? (
                  <>
                    <Spinner animation="border" />
                    <span className="text-warning">
                      {t("settings.controller.press")}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setIsCapturingButton(false);
                        setCapturingVoiceInput(false);
                      }}
                    >
                      {t("settings.cancel")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Badge bg="secondary">
                      {gamepadButton !== null
                        ? getButtonLabel(gamepadButton, t)
                        : t("settings.noButton")}
                    </Badge>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setIsCapturingButton(true);
                        setCapturingVoiceInput(true);
                      }}
                    >
                      {t("settings.assign")}
                    </Button>
                    {gamepadButton !== null && (
                      <Button
                        variant="danger"
                        onClick={() => {
                          setGamepadButton(null);
                          configSet("gamepadTriggerButton", "").catch(
                            reportSaveError,
                          );
                        }}
                      >
                        {t("settings.remove")}
                      </Button>
                    )}
                    {settingSaved === "gamepadButton" && (
                      <span className="text-success">
                        <FontAwesomeIcon icon={faCheck} />{" "}
                        {t("settings.savedM")}
                      </span>
                    )}
                  </>
                )}
              </Col>
            </Form.Group>
            <Row className="mb-3">
              <Col sm={{ span: 9, offset: 3 }}>
                <Form.Text>{t("settings.controller.hint")}</Form.Text>
              </Col>
            </Row>

            <Form.Group as={Row} className="mb-2">
              <Form.Label column sm={3}>
                {t("settings.keyboard.label")}
              </Form.Label>
              <Col sm={9} className="d-flex align-items-center gap-2 flex-wrap">
                {isCapturingKey ? (
                  <>
                    <Spinner animation="border" />
                    <span className="text-warning">
                      {t("settings.keyboard.press")}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setIsCapturingKey(false);
                        setCapturingVoiceInput(false);
                      }}
                    >
                      {t("settings.cancel")}
                    </Button>
                  </>
                ) : (
                  <>
                    {keyboardVoiceKey ? (
                      <KeyComboDisplay combo={keyboardVoiceKey} />
                    ) : (
                      <Badge bg="secondary">{t("settings.noButton")}</Badge>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setIsCapturingKey(true);
                        setCapturingVoiceInput(true);
                      }}
                    >
                      {t("settings.assign")}
                    </Button>
                    {keyboardVoiceKey && (
                      <Button
                        variant="danger"
                        onClick={() => {
                          setKeyboardVoiceKey(null);
                          configSet("keyboardVoiceKey", "").catch(
                            reportSaveError,
                          );
                        }}
                      >
                        {t("settings.remove")}
                      </Button>
                    )}
                    {settingSaved === "keyboardKey" && (
                      <span className="text-success">
                        <FontAwesomeIcon icon={faCheck} />{" "}
                        {t("settings.savedM")}
                      </span>
                    )}
                  </>
                )}
              </Col>
            </Form.Group>
            <Row className="mb-3">
              <Col sm={{ span: 9, offset: 3 }}>
                <Form.Text>{t("settings.keyboard.hint")}</Form.Text>
              </Col>
            </Row>

            <Form.Group as={Row} className="mb-2">
              <Form.Label column sm={3}>
                {t("settings.voiceOutput.label")}
              </Form.Label>
              <Col sm={9} className="d-flex align-items-center">
                <Form.Check
                  type="switch"
                  id="tts-toggle"
                  label={ttsEnabled ? t("settings.on") : t("settings.off")}
                  checked={ttsEnabled}
                  onChange={() => setTtsEnabled(!ttsEnabled)}
                />
              </Col>
            </Form.Group>
            <Row>
              <Col sm={{ span: 9, offset: 3 }}>
                <Form.Text>{t("settings.voiceOutput.hint")}</Form.Text>
              </Col>
            </Row>
          </div>
        </Col>

        <Col md={6}>
          <div className="settings-section">
            <Form.Label className="setting-section-label">
              {t("settings.dev.title")}
            </Form.Label>

            <Form.Group as={Row} className="mb-2" controlId="ace-setups-path">
              <Form.Label column sm={3}>
                {t("settings.dev.aceSetups")}
              </Form.Label>
              <Col sm={7}>
                <Form.Control
                  type="text"
                  value={aceSetupsPath}
                  onChange={(e) => setAceSetupsPath(e.target.value)}
                  placeholder="D:\Salvataggi\ACE\Car Setups"
                />
              </Col>
              <Col sm={2}>
                <Button variant="primary" onClick={handleSaveAceSetupsPath}>
                  {settingSaved === "aceSetupsPath" ? (
                    <>
                      <FontAwesomeIcon icon={faCheck} /> {t("settings.savedM")}
                    </>
                  ) : (
                    t("settings.save")
                  )}
                </Button>
              </Col>
            </Form.Group>
            <Row className="mb-3">
              <Col sm={{ span: 9, offset: 3 }}>
                <Form.Text>
                  <Trans
                    i18nKey="settings.dev.aceSetupsHint"
                    components={{ code: <code /> }}
                  />
                </Form.Text>
              </Col>
            </Row>

            <Form.Group as={Row} className="mb-2">
              <Form.Label column sm={3}>
                {t("settings.dev.mockSessions")}
              </Form.Label>
              <Col sm={9} className="d-flex align-items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setMockHistoryMode(!mockHistoryMode)}
                >
                  {mockHistoryMode
                    ? t("settings.dev.mockOn")
                    : t("settings.dev.mockOff")}
                </Button>
                <span className="text-secondary" style={{ fontSize: 12 }}>
                  {mockHistoryMode
                    ? t("settings.dev.mockOnHint")
                    : t("settings.dev.mockOffHint")}
                </span>
              </Col>
            </Form.Group>
            <Form.Group as={Row} className="mb-3">
              <Form.Label column sm={3}>
                {t("settings.dev.mockUpdate")}
              </Form.Label>
              <Col sm={9} className="d-flex align-items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    window.dispatchEvent(new Event(UPDATE_MOCK_EVENT))
                  }
                >
                  {t("settings.dev.simulateUpdate")}
                </Button>
                <span className="text-secondary" style={{ fontSize: 12 }}>
                  {t("settings.dev.simulateUpdateHint")}
                </span>
              </Col>
            </Form.Group>
            <Row className="mb-3">
              <Col sm={{ span: 9, offset: 3 }}>
                <Form.Text>{t("settings.dev.mockHint")}</Form.Text>
              </Col>
            </Row>

            <Form.Group as={Row} className="mb-2">
              <Form.Label column sm={3}>
                {t("settings.dev.telemetryLog")}
              </Form.Label>
              <Col sm={9} className="d-flex align-items-center">
                <Form.Check
                  type="switch"
                  id="telemetry-log-toggle"
                  label={
                    telemetryLogEnabled ? t("settings.on") : t("settings.off")
                  }
                  checked={telemetryLogEnabled}
                  onChange={handleToggleTelemetry}
                />
              </Col>
            </Form.Group>
            <Row>
              <Col sm={{ span: 9, offset: 3 }}>
                <Form.Text>
                  <Trans
                    i18nKey="settings.dev.telemetryHint"
                    values={{ pattern: t("settings.dev.telemetryPattern") }}
                    components={{ code: <code /> }}
                  />
                  {telemetryLogEnabled && telemetryLogDir && (
                    <>
                      {" "}
                      <Trans
                        i18nKey="settings.dev.telemetryDir"
                        values={{ dir: telemetryLogDir }}
                        components={{ code: <code /> }}
                      />
                    </>
                  )}
                </Form.Text>
              </Col>
            </Row>
          </div>
        </Col>
      </Row>

      {/* Debug frame */}
      {frame && (
        <div className="settings-section">
          <Form.Label className="setting-section-label">
            {t("settings.debugFrame")}
          </Form.Label>
          <pre className="debug-frame">
            {JSON.stringify(
              {
                car: frame.carName,
                track: frame.trackName,
                speed: frame.carSpeed?.toFixed(1) ?? "0" + " km/h",
                gear: frame.gear,
                dist: frame.lapDistance?.toFixed(0) ?? "0" + "m",
                thr: (frame.throttle * 100).toFixed(0) + "%",
                brk: (frame.brake * 100).toFixed(0) + "%",
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </Container>
  );
};

export default SettingsPanel;
