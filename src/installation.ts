import { parseInstallationConfig } from "../installation/model.ts";

declare const __AP2_INSTALLATION__: unknown;

export const installation = parseInstallationConfig(__AP2_INSTALLATION__);
