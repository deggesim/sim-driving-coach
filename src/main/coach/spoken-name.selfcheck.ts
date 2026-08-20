// Self-check: il nome del setup dettato a voce finisce su una riga
// session_setups_* e da lì nei prompt e nel PDF. Una regressione qui non dà
// errori, dà setup chiamati "vu uno" o "setup d gara".
import assert from "node:assert/strict";
import { normalizeSpokenName } from "./spoken-name.js";

const eq = (spoken: string, expected: string) =>
  assert.equal(
    normalizeSpokenName(spoken),
    expected,
    `"${spoken}" -> "${normalizeSpokenName(spoken)}" invece di "${expected}"`,
  );

// ── Lettere compitate + numeri: i due casi della specifica ───────────────────
eq("vu uno", "v1");
eq("Emme quattordici", "m14");
eq("erre esse ics", "rsx");
eq("effe uno", "f1");
eq("gi pi due", "gp2");

// ── Inglese, anche mescolato all'italiano ────────────────────────────────────
eq("em fourteen", "m14");
eq("vee one", "v1");
eq("double u three", "w3");
eq("emme one", "m1");
eq("bee twenty one", "b21");
eq("bee twenty-one", "b21");

// ── Numeri mai a parole, decine composte comprese ────────────────────────────
eq("gara quattordici", "gara 14");
eq("gara ventuno", "gara 21");
eq("gara ventitré", "gara 23");
eq("gara ventitre", "gara 23");
eq("gara ventotto", "gara 28");
eq("gara novantanove", "gara 99");
eq("gara thirty five", "gara 35");

// ── Simboli detti a parole ───────────────────────────────────────────────────
eq("vu uno trattino basso gara", "v1_gara");
eq("vu uno underscore gara", "v1_gara");
eq("vu uno meno due", "v1-2");
eq("vu uno trattino due", "v1-2");
eq("v one dash two", "v1-2");
eq("vu uno spazio gara", "v1 gara");
eq("v one space race", "v1 race");
eq("gara punto due", "gara.2");
eq("gara slash due", "gara/2");
eq("setup barra b", "setup/b");

// ── Tutto minuscolo ──────────────────────────────────────────────────────────
eq("Qualifica Monza", "qualifica monza");
eq("VU UNO", "v1");

// ── Lettere singole già trascritte come tali ─────────────────────────────────
eq("v 1", "v1");
eq("m 14 gara", "m14 gara");

// ── Le parole che sono anche nomi di lettera restano parole fuori da una
//    sequenza compitata: "di", "ci", "e", "a" sono italiano corrente ──────────
eq("setup di gara", "setup di gara");
eq("gara e qualifica", "gara e qualifica");
eq("setup a caldo", "setup a caldo");
eq("prova ti amo", "prova ti amo");
// ...ma dentro la sequenza tornano lettere
eq("di quattro", "d4");
eq("ci uno", "c1");

// ── Il punto finale che Azure STT appende non è un simbolo dettato ───────────
eq("Qualifica Monza.", "qualifica monza");
eq("vu uno.", "v1");
eq("gara punto", "gara.");

// ── Casi degeneri: il chiamante distingue solo stringa vuota ─────────────────
eq("", "");
eq("   ", "");
eq("annulla", "annulla");

console.log("spoken-name.selfcheck OK");
