---
paths:
  - "src/renderer/**"
  - "electron.vite.config.ts"
---

# Renderer libraries, tooling and theme

Loaded only when working on renderer files. Rules that apply everywhere live in the
other files under `.claude/rules/`; architecture-wide decisions in the root `CLAUDE.md`.

## Libraries & Tooling

- **UI framework**: Bootstrap + react-bootstrap. Use react-bootstrap components (`Button`, `Form`, `Modal`, etc.) — do not write raw Bootstrap HTML classes manually when a component exists.
- **State management**: Zustand. Use `create()` from `zustand` for all global state. Prefer slices for large stores. No Redux, no Context API for app state.
- **HTTP**: Axios for all REST service calls. Define typed request/response shapes. Create a shared axios instance (base URL, interceptors) rather than calling `axios.get/post` directly in components.
- **Build tool**: electron-vite. Keep `electron.vite.config.ts` minimal. Use `import.meta.env` for environment variables — never `process.env` in frontend code.
- **Icons**: Prefer [Font Awesome Free](https://fontawesome.com/icons) icons via `@fortawesome/react-fontawesome`. Import icons individually — never import the full bundle. Always destructure the specific icon from its package:
  ```tsx
  import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
  import { faCircleCheck } from "@fortawesome/free-solid-svg-icons";
  ```
  Do not do `import * as icons from '@fortawesome/free-solid-svg-icons'` or import a collection object.

## UI Theme

The app uses a **dark theme** exclusively. All UI components must use the CSS custom properties defined in `:root` (`--bg`, `--bg2`, `--bg3`, `--border`, `--text`, `--text-dim`, `--accent`). Never use Bootstrap's default light-background components without overriding them with the dark theme variables. When adding new Bootstrap components (Modal, Accordion, Card, etc.), always add corresponding dark-theme CSS overrides in `global.css`.
