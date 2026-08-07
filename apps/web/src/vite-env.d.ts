/// <reference types="vite/client" />

declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "pdfjs-dist/legacy/build/pdf.min.mjs";
