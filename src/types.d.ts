declare module "*.html" {
  const content: string;
  export default content;
}

// Skript- und Style-Teile der Oberfläche (src/ui/*.js.txt, *.css.txt), von Wrangler als Text geladen
declare module "*.txt" {
  const content: string;
  export default content;
}

declare module "*.woff2" {
  const content: ArrayBuffer;
  export default content;
}

declare module "*.png" {
  const content: ArrayBuffer;
  export default content;
}
