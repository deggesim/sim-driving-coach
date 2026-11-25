import { CloseButton, Toast, ToastContainer } from "react-bootstrap";

type AppToastProps = {
  variant?: string;
  text?: string | null;
  onClose: () => void;
  zIndex?: number;
};

const ICONS: Record<string, string> = {
  success: "bi-check-circle-fill",
  danger: "bi-exclamation-octagon-fill",
  warning: "bi-exclamation-triangle-fill",
  info: "bi-info-circle-fill",
};

// Dark card, coloured border, the icon tells the kind; top-centre, auto-hides.
export const AppToast = ({
  variant = "info",
  text,
  onClose,
  zIndex = 1050,
}: AppToastProps) => (
  <ToastContainer
    position="top-center"
    className="p-3"
    style={{ position: "fixed", zIndex }}
  >
    <Toast
      show={!!text}
      onClose={onClose}
      autohide
      delay={5000}
      className={`app-toast app-toast--${variant}`}
    >
      <Toast.Body className="d-flex align-items-start gap-2">
        <i
          className={`bi ${ICONS[variant] ?? ICONS.info} app-toast__icon`}
          aria-hidden
        />
        <span className="flex-grow-1">{text}</span>
        <CloseButton variant="white" onClick={onClose} />
      </Toast.Body>
    </Toast>
  </ToastContainer>
);
