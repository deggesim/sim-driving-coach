declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

declare module "*.png" {
  const src: string;
  export default src;
}

// Injected by electron.vite.config.ts from package.json.
declare const __APP_VERSION__: string;

interface ImportMeta {
  readonly env: { readonly DEV: boolean };
}
