import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseInstallationConfig } from "./model.ts";

export const DEFAULT_INSTALLATION_CONFIG_PATH =
  "installations/development.json";

export function loadInstallationConfig(
  path = process.env.AP2_INSTALLATION_CONFIG ?? DEFAULT_INSTALLATION_CONFIG_PATH,
) {
  const resolvedPath = resolve(path);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read AP2 installation configuration at ${resolvedPath}`, {
      cause: error,
    });
  }
  return parseInstallationConfig(value);
}

export const installation = loadInstallationConfig();
