import type { Language } from "../../shared/i18n";

const FLAGS: Record<Language, React.ReactNode> = {
  de: (
    <>
      <rect width="20" height="4.67" fill="#000" />
      <rect y="4.67" width="20" height="4.67" fill="#d00" />
      <rect y="9.33" width="20" height="4.67" fill="#ffce00" />
    </>
  ),
  en: (
    <>
      <rect width="20" height="14" fill="#012169" />
      <path d="M0 0L20 14M20 0L0 14" stroke="#fff" strokeWidth="3" />
      <path d="M0 0L20 14M20 0L0 14" stroke="#c8102e" strokeWidth="1" />
      <path d="M10 0V14M0 7H20" stroke="#fff" strokeWidth="4.5" />
      <path d="M10 0V14M0 7H20" stroke="#c8102e" strokeWidth="2.5" />
    </>
  ),
  es: (
    <>
      <rect width="20" height="14" fill="#aa151b" />
      <rect y="3.5" width="20" height="7" fill="#f1bf00" />
    </>
  ),
  fr: (
    <>
      <rect width="6.67" height="14" fill="#0055a4" />
      <rect x="6.67" width="6.67" height="14" fill="#fff" />
      <rect x="13.33" width="6.67" height="14" fill="#ef4135" />
    </>
  ),
  it: (
    <>
      <rect width="6.67" height="14" fill="#009246" />
      <rect x="6.67" width="6.67" height="14" fill="#fff" />
      <rect x="13.33" width="6.67" height="14" fill="#ce2b37" />
    </>
  ),
};

export const LanguageFlag = ({ code }: { code: Language }) => (
  <svg
    width="20"
    height="14"
    viewBox="0 0 20 14"
    aria-hidden="true"
    className="language-flag"
  >
    {FLAGS[code]}
  </svg>
);
