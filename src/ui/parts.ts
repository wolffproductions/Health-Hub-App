// Alle Teile der Oberfläche. Neue Datei in src/ui/ → hier eintragen und im Grundgerüst
// (shell.html) eine Zeile „<!-- ui:name -->“ an die passende Stelle setzen.
// Skript- und Style-Teile heißen *.js.txt bzw. *.css.txt: Skripte sind normale Abschnitte (kein Modul), die
// nacheinander im selben <script> laufen wie bisher. Wrangler würde .js/.css selbst bündeln,
// .txt bindet es dagegen als Text ein. Im Grundgerüst heißen sie ohne .txt (z. B. „core.js“).
import shell from "./shell.html";
import styles from "./styles.css.txt";
import heuteHtml from "./heute.html";
import trainingHtml from "./training.html";
import leistungHtml from "./leistung.html";
import schlafHtml from "./schlaf.html";
import einheitenHtml from "./einheiten.html";
import einheitHtml from "./einheit.html";
import freundHtml from "./freund.html";
import diagrammHtml from "./diagramm.html";
import balanceHtml from "./balance.html";
import freundeHtml from "./freunde.html";
import kontoHtml from "./konto.html";
import radwetterHtml from "./radwetter.html";
import radwetterCss from "./radwetter.css.txt";
import core from "./core.js.txt";
import icons from "./icons.js.txt";
import karte from "./karte.js.txt";
import exportJs from "./export.js.txt";
import heuteJs from "./heute.js.txt";
import trainingJs from "./training.js.txt";
import leistungJs from "./leistung.js.txt";
import koerperJs from "./koerper.js.txt";
import schlafJs from "./schlaf.js.txt";
import einheitenJs from "./einheiten.js.txt";
import planJs from "./plan.js.txt";
import einheitJs from "./einheit.js.txt";
import freundJs from "./freund.js.txt";
import diagrammJs from "./diagramm.js.txt";
import balanceJs from "./balance.js.txt";
import freundeJs from "./freunde.js.txt";
import neuJs from "./neu.js.txt";
import figurJs from "./figur.js.txt";
import radwetterJs from "./radwetter.js.txt";
import radwetterKontoJs from "./radwetter-konto.js.txt";
import levelJs from "./level.js.txt";
import kontoJs from "./konto.js.txt";
import ablauf from "./ablauf.js.txt";
import daten from "./daten.js.txt";
import start from "./start.js.txt";

export const UI_SHELL: string = shell;

export const UI_PARTS: Record<string, string> = {
  "styles.css": styles,
  "radwetter.css": radwetterCss,
  "heute.html": heuteHtml,
  "training.html": trainingHtml,
  "leistung.html": leistungHtml,
  "schlaf.html": schlafHtml,
  "einheiten.html": einheitenHtml,
  "einheit.html": einheitHtml,
  "freund.html": freundHtml,
  "diagramm.html": diagrammHtml,
  "balance.html": balanceHtml,
  "freunde.html": freundeHtml,
  "konto.html": kontoHtml,
  "radwetter.html": radwetterHtml,
  "core.js": core,
  "icons.js": icons,
  "karte.js": karte,
  "export.js": exportJs,
  "heute.js": heuteJs,
  "training.js": trainingJs,
  "leistung.js": leistungJs,
  "koerper.js": koerperJs,
  "schlaf.js": schlafJs,
  "einheiten.js": einheitenJs,
  "plan.js": planJs,
  "einheit.js": einheitJs,
  "freund.js": freundJs,
  "diagramm.js": diagrammJs,
  "balance.js": balanceJs,
  "freunde.js": freundeJs,
  "neu.js": neuJs,
  "figur.js": figurJs,
  "radwetter.js": radwetterJs,
  "radwetter-konto.js": radwetterKontoJs,
  "level.js": levelJs,
  "konto.js": kontoJs,
  "ablauf.js": ablauf,
  "daten.js": daten,
  "start.js": start,
};
