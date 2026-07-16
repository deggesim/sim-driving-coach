# AMS2 Setup 3-Tab View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display AMS2 setups in three tabs (Tyres/Brakes/Chassis · Suspension · Drivetrain) with fixed sections, mirroring the in-game setup screens.

**Architecture:** Constrain the Claude Vision decode to a fixed `category` vocabulary; extract the shared 4-corner-grid primitives from `AceSetupTabs` into `SetupTabsCommon.tsx`; add a React-free `ams2-setup-sections.ts` mapping module (unit-tested) + a new `Ams2SetupTabs.tsx` that renders tabs/sections; wire it into `SetupDetailModal` and the `Ams2SetupPicker` verify phase. Unmapped categories fall into an "Altro" section.

**Tech Stack:** Electron + React 19 + TypeScript (strict), react-bootstrap, `@anthropic-ai/sdk` (Models/Messages), existing `setup-*` CSS classes.

## Global Constraints

- TypeScript strict. Prefer `type` over `interface`. Named exports; relative imports only. **Arrow functions only** — never the `function` keyword. No `class`. English comments/code.
- UI: react-bootstrap components (`Nav`, etc.); dark theme via existing CSS custom properties; reuse `setup-*` classes — **no new CSS**. FontAwesome icons imported individually (not used in this feature).
- Tab labels in **English** (`Tyres/Brakes/Chassis`, `Suspension`, `Drivetrain`); section names in **Italian**.
- Fixed AMS2 category vocabulary (exact strings): `Gomme`, `Freni`, `Chassis`, `Sospensioni`, `Anteriore`, `Posteriore`, `Sospensioni attive`, `Motore/Elettronica`, `Rapporti del cambio`, `Differenziale`. Plus component-side `Altro` fallback.
- Per-corner params carry a wheel-code suffix in the parameter name: ` FL` ` FR` ` RL` ` RR` (matches regex `\s(FL|FR|RL|RR)(\s|$)`).
- No new npm dependencies.
- After every task: `npm run typecheck` and `npm run lint` must be clean (baseline: 1 pre-existing warning in `SetupSelectionModal.tsx` — do not introduce more).
- Every commit message ends with the standard two-line trailer (`Co-Authored-By:` / `Claude-Session:`) — omitted from the commands below for brevity.
- Scratchpad dir for the self-check (bash): `SCRATCH="/c/Users/simon/AppData/Local/Temp/claude/D--Progetti-sim-driving-coach/766a28f3-c4ee-4b55-bb68-1e94f3ec6cd3/scratchpad"`

---

### Task 1: Extract shared setup-tab primitives

Move the reusable grid/table primitives out of `AceSetupTabs.tsx` into a shared module so `Ams2SetupTabs` can reuse them. Pure move — no behavior change for ACE.

**Files:**
- Create: `src/renderer/components/SetupTabsCommon.tsx`
- Modify: `src/renderer/components/AceSetupTabs.tsx`

**Interfaces:**
- Produces (from `SetupTabsCommon`):
  - `WHEEL_KEYS: readonly ["FL","FR","RL","RR"]`, `type WheelKey`
  - `WHEEL_LABELS: Record<WheelKey, string>`
  - `getWheelKey(parameter: string): WheelKey | null`
  - `stripWheelSuffix(parameter: string): string`
  - `ParamTable` — props `{ rows: Array<{ label: string; value: string }> }`
  - `FourCornerGrid` — props `{ params: SetupParam[] }`

- [ ] **Step 1: Create `SetupTabsCommon.tsx`**

```tsx
import type { SetupParam } from "../../shared/types";

export const WHEEL_KEYS = ["FL", "FR", "RL", "RR"] as const;
export type WheelKey = (typeof WHEEL_KEYS)[number];

export const WHEEL_LABELS: Record<WheelKey, string> = {
  FL: "Ant. Sinistro",
  FR: "Ant. Destro",
  RL: "Post. Sinistro",
  RR: "Post. Destro",
};

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
  return (
    <table className="setup-tab-table w-100">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="text-muted">{r.label}</td>
            <td className="setup-value">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const FourCornerGrid = ({ params }: { params: SetupParam[] }) => {
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
              <div className="setup-subsection-title">{WHEEL_LABELS[key]}</div>
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
```

- [ ] **Step 2: Trim `AceSetupTabs.tsx` to import the primitives**

Remove the local `WHEEL_KEYS`, `WheelKey`, `WHEEL_LABELS`, `getWheelKey`, `stripWheelSuffix`, `ParamTable`, `FourCornerGrid` definitions (current lines ~15–117). Replace the top imports with:

```tsx
import { useState } from "react";
import { Nav } from "react-bootstrap";
import type { SetupParam } from "../../shared/types";
import { ParamTable, FourCornerGrid, getWheelKey } from "./SetupTabsCommon";
```

Keep everything from `ACE_TAB_ORDER` onward unchanged (`AceTabId`, `getAceTab`, `SuspensionTab`, `AceSetupTabs`, `export default AceSetupTabs`). `SuspensionTab` already calls `getWheelKey`, `FourCornerGrid`, and `ParamTable` — now imported.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: typecheck clean; lint clean except the 1 pre-existing `SetupSelectionModal.tsx` warning.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/SetupTabsCommon.tsx src/renderer/components/AceSetupTabs.tsx
git commit -m "refactor(setup-tabs): extract shared 4-corner grid primitives"
```

---

### Task 2: AMS2 section/tab mapping module (with runnable self-check)

The pure, React-free mapping from `category` → section → tab. This is the only non-trivial logic, so it gets a runnable assert.

**Files:**
- Create: `src/renderer/components/ams2-setup-sections.ts`
- Test (scratch, not committed): `$SCRATCH/check-ams2-sections.mjs`

**Interfaces:**
- Produces:
  - `AMS2_TABS: readonly ["Tyres/Brakes/Chassis","Suspension","Drivetrain"]`, `type Ams2Tab`
  - `type Ams2Section` (the 11 fixed section strings incl. `"Altro"`)
  - `SECTION_TO_TAB: Record<Ams2Section, Ams2Tab>`
  - `TAB_SECTIONS: Record<Ams2Tab, Ams2Section[]>` (render order)
  - `GRID_SECTIONS: ReadonlySet<Ams2Section>` (`"Gomme"`, `"Sospensioni"`)
  - `sectionForCategory(category: string): Ams2Section`

- [ ] **Step 1: Write the self-check script (fails first — module absent)**

Create `$SCRATCH/check-ams2-sections.mjs`:

```js
import assert from "node:assert/strict";
import {
  AMS2_TABS,
  SECTION_TO_TAB,
  TAB_SECTIONS,
  GRID_SECTIONS,
  sectionForCategory,
} from "./ams2-setup-sections.js";

// known category → itself (with trim); unknown/empty → "Altro"
assert.equal(sectionForCategory("Freni"), "Freni");
assert.equal(sectionForCategory("  Gomme "), "Gomme");
assert.equal(sectionForCategory("Differenziale"), "Differenziale");
assert.equal(sectionForCategory("Aerodinamica"), "Altro");
assert.equal(sectionForCategory(""), "Altro");

// every section maps to a real tab
for (const [section, tab] of Object.entries(SECTION_TO_TAB)) {
  assert.ok(AMS2_TABS.includes(tab), `${section} -> unknown tab ${tab}`);
}

// TAB_SECTIONS agrees with SECTION_TO_TAB and covers each section exactly once
const seen = new Set();
for (const tab of AMS2_TABS) {
  for (const section of TAB_SECTIONS[tab]) {
    assert.equal(SECTION_TO_TAB[section], tab, `${section} in wrong tab list`);
    assert.ok(!seen.has(section), `${section} listed twice`);
    seen.add(section);
  }
}
assert.equal(
  seen.size,
  Object.keys(SECTION_TO_TAB).length,
  "section coverage mismatch",
);

// grid sections are real sections
for (const s of GRID_SECTIONS) assert.ok(seen.has(s), `grid section ${s} missing`);

console.log("ams2-setup-sections self-check OK");
```

- [ ] **Step 2: Run it — verify it fails (module not compiled yet)**

```bash
SCRATCH="/c/Users/simon/AppData/Local/Temp/claude/D--Progetti-sim-driving-coach/766a28f3-c4ee-4b55-bb68-1e94f3ec6cd3/scratchpad"
node "$SCRATCH/check-ams2-sections.mjs"
```
Expected: FAIL — `Cannot find module '.../ams2-setup-sections.js'`.

- [ ] **Step 3: Write `ams2-setup-sections.ts`**

```ts
export const AMS2_TABS = [
  "Tyres/Brakes/Chassis",
  "Suspension",
  "Drivetrain",
] as const;
export type Ams2Tab = (typeof AMS2_TABS)[number];

export type Ams2Section =
  | "Gomme"
  | "Freni"
  | "Chassis"
  | "Altro"
  | "Sospensioni"
  | "Anteriore"
  | "Posteriore"
  | "Sospensioni attive"
  | "Motore/Elettronica"
  | "Rapporti del cambio"
  | "Differenziale";

export const SECTION_TO_TAB: Record<Ams2Section, Ams2Tab> = {
  Gomme: "Tyres/Brakes/Chassis",
  Freni: "Tyres/Brakes/Chassis",
  Chassis: "Tyres/Brakes/Chassis",
  Altro: "Tyres/Brakes/Chassis",
  Sospensioni: "Suspension",
  Anteriore: "Suspension",
  Posteriore: "Suspension",
  "Sospensioni attive": "Suspension",
  "Motore/Elettronica": "Drivetrain",
  "Rapporti del cambio": "Drivetrain",
  Differenziale: "Drivetrain",
};

// Render order of sections within each tab.
export const TAB_SECTIONS: Record<Ams2Tab, Ams2Section[]> = {
  "Tyres/Brakes/Chassis": ["Gomme", "Freni", "Chassis", "Altro"],
  Suspension: ["Sospensioni", "Anteriore", "Posteriore", "Sospensioni attive"],
  Drivetrain: ["Motore/Elettronica", "Rapporti del cambio", "Differenziale"],
};

// Sections rendered as a per-corner (FL/FR/RL/RR) grid.
export const GRID_SECTIONS: ReadonlySet<Ams2Section> = new Set<Ams2Section>([
  "Gomme",
  "Sospensioni",
]);

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(
  (Object.keys(SECTION_TO_TAB) as Ams2Section[]).filter((s) => s !== "Altro"),
);

// Map a decoded param's free-form category to a known section; unknown → "Altro".
export const sectionForCategory = (category: string): Ams2Section => {
  const c = category.trim();
  return (KNOWN_CATEGORIES.has(c) ? c : "Altro") as Ams2Section;
};
```

- [ ] **Step 4: Compile the module to scratch, run the self-check — verify it passes**

```bash
SCRATCH="/c/Users/simon/AppData/Local/Temp/claude/D--Progetti-sim-driving-coach/766a28f3-c4ee-4b55-bb68-1e94f3ec6cd3/scratchpad"
npx tsc --ignoreConfig --module NodeNext --moduleResolution NodeNext --target ES2022 \
  --strict --outDir "$SCRATCH" src/renderer/components/ams2-setup-sections.ts
node "$SCRATCH/check-ams2-sections.mjs"
```
Expected: `ams2-setup-sections self-check OK`.

- [ ] **Step 5: Project typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean (baseline warning only).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ams2-setup-sections.ts
git commit -m "feat(ams2-setup): fixed category→tab/section mapping"
```

---

### Task 3: `Ams2SetupTabs` component

Renders the 3 tabs and their sections from `SetupParam[]`.

**Files:**
- Create: `src/renderer/components/Ams2SetupTabs.tsx`

**Interfaces:**
- Consumes: `ParamTable`, `FourCornerGrid` (Task 1); `AMS2_TABS`, `TAB_SECTIONS`, `GRID_SECTIONS`, `sectionForCategory`, `Ams2Tab`, `Ams2Section` (Task 2); `SetupParam` (`src/shared/types`).
- Produces: `export default Ams2SetupTabs` — props `{ params: SetupParam[] }`.

- [ ] **Step 1: Write the component**

```tsx
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
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean (baseline warning only).

> No renderer test runner exists in this repo; component rendering is verified by typecheck + lint here and by the manual integration run in Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/Ams2SetupTabs.tsx
git commit -m "feat(ams2-setup): 3-tab setup view component"
```

---

### Task 4: Wire the component into the two display surfaces

**Files:**
- Modify: `src/renderer/components/SetupDetailModal.tsx`
- Modify: `src/renderer/components/Ams2SetupPicker.tsx`

**Interfaces:**
- Consumes: `Ams2SetupTabs` default export (Task 3).

- [ ] **Step 1: `SetupDetailModal.tsx` — add the AMS2 branch**

Add the import alongside the existing setup-tabs imports:

```tsx
import Ams2SetupTabs from "./Ams2SetupTabs";
```

Replace the render branch:

```tsx
        {row.setup.params.length > 0 ? (
          game === "ace" ? (
            <AceSetupTabs params={row.setup.params} />
          ) : (
            <R3eSetupTabs params={row.setup.params} />
          )
        ) : (
```

with:

```tsx
        {row.setup.params.length > 0 ? (
          game === "ace" ? (
            <AceSetupTabs params={row.setup.params} />
          ) : game === "ams2" ? (
            <Ams2SetupTabs params={row.setup.params} />
          ) : (
            <R3eSetupTabs params={row.setup.params} />
          )
        ) : (
```

- [ ] **Step 2: `Ams2SetupPicker.tsx` — replace the flat table in the verify phase**

Add the import:

```tsx
import Ams2SetupTabs from "./Ams2SetupTabs";
```

Replace the params block (the `{decodedSetup.params.length > 0 && ( ... <table className="setup-table"> ... )}` region) with:

```tsx
            {decodedSetup.params.length > 0 && (
              <div className="picker-params">
                <Ams2SetupTabs params={decodedSetup.params} />
              </div>
            )}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean (baseline warning only).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/SetupDetailModal.tsx src/renderer/components/Ams2SetupPicker.tsx
git commit -m "feat(ams2-setup): render 3-tab view in detail modal and picker verify"
```

---

### Task 5: Constrain the Vision decode prompt

Make the decode emit the fixed category vocabulary and wheel-suffixed per-corner params, so new decodes populate the tabs correctly.

**Files:**
- Modify: `src/main/main.ts` (the `systemPrompt` inside `ipcMain.handle("setup:decodeSetup", ...)`)

- [ ] **Step 1: Update the prompt**

Replace this line in `systemPrompt`:

```
Estrai TUTTI i parametri di setup visibili: sospensioni, freni, aerodinamica, trasmissione, gomme, differenziale, elettronica, ecc.
```

with:

```
Estrai TUTTI i parametri di setup visibili.
Per ogni parametro assegna "category" ESATTAMENTE uno di questi valori:
- "Gomme": parametri gomma per singola ruota (pressioni, ecc.)
- "Freni": pressione/bilanciamento freni, condotti freni
- "Chassis": parametri telaio non per-ruota (zavorra, ripartizione pesi, sterzo)
- "Sospensioni": parametri sospensione per singola ruota (altezza, molla, camber, convergenza, ammortizzatori bump/rebound, ecc.)
- "Anteriore": parametri sospensione assale anteriore non per-ruota (es. barra antirollio anteriore)
- "Posteriore": parametri sospensione assale posteriore non per-ruota (es. barra antirollio posteriore)
- "Sospensioni attive": parametri di sospensione attiva, se presenti
- "Motore/Elettronica": mappa motore, freno motore, boost, TC, ABS, ecc.
- "Rapporti del cambio": rapporto finale e singole marce
- "Differenziale": precarico, rampe power/coast, dischi, differenziale anteriore e posteriore
Per i parametri per singola ruota (category "Gomme" e "Sospensioni") crea un parametro per ruota e aggiungi il codice ruota in fondo al nome del parametro: " FL", " FR", " RL", " RR" (es. "Pressione FL"). Non usare categorie diverse da quelle elencate.
```

(Leave the following `IMPORTANTE — precisione numerica: ...` and `Restituisci solo il JSON...` lines unchanged.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(ams2-setup): constrain Vision decode to fixed category vocabulary"
```

- [ ] **Step 4: Manual integration verification (no automated harness for Vision / renderer)**

With `npm run dev`, AMS2 running, an Anthropic API key configured, and AMS2 setup screenshots captured (F12):
1. Open a session for AMS2 → "Carica setup" → `Ams2SetupPicker` → select the setup screenshots → "Decodifica setup".
2. In the **verify** phase, confirm the 3 tabs render (Tyres/Brakes/Chassis, Suspension, Drivetrain) with the expected sections; per-corner values appear in the 4-corner grid (Gomme / Sospensioni).
3. Save the setup, reopen it via `SetupDetailModal` (session detail / setup history) → confirm the same 3-tab view.
4. Confirm any unrecognized param lands in an "Altro" section (first tab) rather than breaking the view.

Expected: categories are all within the fixed vocabulary; per-corner params carry the wheel suffix; tabs/sections match the spec. If Vision output is truncated (unlikely), raise `max_tokens` from 4000 to ~6000 in the same handler.

---

## Self-Review

**Spec coverage:**
- 3 tabs + fixed sections → Task 2 (`AMS2_TABS`, `TAB_SECTIONS`) + Task 3 (render). ✓
- Fixed category vocabulary from decode → Task 5. ✓
- Per-corner grid via wheel suffix → Task 1 (`FourCornerGrid`/`getWheelKey`) + Task 5 (suffix rule) + Task 2 (`GRID_SECTIONS`). ✓
- "Altro" fallback → Task 2 (`sectionForCategory`) + Task 3 (rendered when present). ✓
- Both display surfaces → Task 4. ✓
- Shared primitives extraction (approach A) → Task 1. ✓
- Reuse `setup-*` CSS, no new CSS → Tasks 1/3 use existing classes. ✓
- Backward compat (legacy setups → Altro) → Task 2 unknown-category branch; verified in Task 5 step 4. ✓

**Placeholder scan:** none — every code/edit step shows full content; commands include expected output.

**Type consistency:** `sectionForCategory` returns `Ams2Section`; `SECTION_TO_TAB`/`TAB_SECTIONS` keyed by `Ams2Section`/`Ams2Tab`; `Ams2SetupTabs` props `{ params: SetupParam[] }` match both consumers (`SetupDetailModal`, `Ams2SetupPicker`). `FourCornerGrid`/`ParamTable` prop shapes unchanged from the original `AceSetupTabs`.
