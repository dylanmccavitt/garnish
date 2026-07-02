export const garnishExtensionEntrypoint = "garnish-extension" as const;
export * from "./extension/index";
export { createGarnishExtension as default } from "./extension/index";
