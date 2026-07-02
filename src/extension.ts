export const garnishExtensionEntrypoint = "garnish-extension" as const;
export * from "./extension/index";
export * from "./extension/hud";
export * from "./extension/unlocks";
export { createGarnishExtension as default } from "./extension/index";
