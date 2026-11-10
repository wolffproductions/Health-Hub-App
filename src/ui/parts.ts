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
import diagrammHtml from "./diagramm.html";
import balanceHtml from "./balance.html";
import kontoHtml from "./konto.html";
import core from "./core.js.txt";
import icons from "./icons.js.txt";
import karte from "./karte.js.txt";
import heuteJs from "./heute.js.txt";
import trainingJs from "./training.js.txt";
import leistungJs from "./leistung.js.txt";
import koerperJs from "./koerper.js.txt";
import schlafJs from "./schlaf.js.txt";
import einheitenJs from "./einheiten.js.txt";
import einheitJs from "./einheit.js.txt";
import diagrammJs from "./diagramm.js.txt";
import balanceJs from "./balance.js.txt";
import neuJs from "./neu.js.txt";
import kontoJs from "./konto.js.txt";
import ablauf from "./ablauf.js.txt";
import daten from "./daten.js.txt";
import start from "./start.js.txt";

export const UI_SHELL: string = shell;

export const UI_PARTS: Record<string, string> = {
  "styles.css": styles,
  "heute.html": heuteHtml,
  "training.html": trainingHtml,
  "leistung.html": leistungHtml,
  "schlaf.html": schlafHtml,
  "einheiten.html": einheitenHtml,
  "einheit.html": einheitHtml,
  "diagramm.html": diagrammHtml,
  "balance.html": balanceHtml,
  "konto.html": kontoHtml,
  "core.js": core,
  "icons.js": icons,
  "karte.js": karte,
  "heute.js": heuteJs,
  "training.js": trainingJs,
  "leistung.js": leistungJs,
  "koerper.js": koerperJs,
  "schlaf.js": schlafJs,
  "einheiten.js": einheitenJs,
  "einheit.js": einheitJs,
  "diagramm.js": diagrammJs,
  "balance.js": balanceJs,
  "neu.js": neuJs,
  "konto.js": kontoJs,
  "ablauf.js": ablauf,
  "daten.js": daten,
  "start.js": start,
};
