// Setzt die Oberfläche aus den Teilen in src/ui/ zu einer Seite zusammen.
// Jede Zeile „<!-- ui:datei -->“ im Grundgerüst (shell.html) wird durch den Inhalt der Datei ersetzt.
// Reine Funktion ohne Abhängigkeiten, damit sie auch in den Tests (Node) läuft.

export const UI_MARKER = /^[ \t]*<!-- ui:([\w.-]+) -->\r?\n/gm;

export function assembleUi(shell: string, parts: Record<string, string>): string {
  const used = new Set<string>();
  const html = shell.replace(UI_MARKER, (_m, name: string) => {
    const part = parts[name];
    if (part === undefined) throw new Error(`UI-Teil fehlt: ${name}`);
    used.add(name);
    return part;
  });
  const unused = Object.keys(parts).filter((n) => !used.has(n));
  if (unused.length) throw new Error(`UI-Teile ohne Platzhalter im Grundgerüst: ${unused.join(", ")}`);
  return html;
}
