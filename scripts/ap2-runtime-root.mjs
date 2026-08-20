import { isAbsolute, join, resolve } from "node:path";

export function resolveAp2RuntimeRoot(environment = process.env) {
  const configured = environment.AP2_RUNTIME_ROOT?.trim();
  if (configured) return absolute(configured, "AP2_RUNTIME_ROOT");

  const dataHome = environment.XDG_DATA_HOME?.trim();
  if (dataHome) {
    return join(absolute(dataHome, "XDG_DATA_HOME"), "ap2", "runtime");
  }

  const home = environment.HOME?.trim();
  if (!home) {
    throw new Error(
      "AP2_RUNTIME_ROOT or an absolute HOME/XDG_DATA_HOME is required",
    );
  }
  return join(absolute(home, "HOME"), ".local", "share", "ap2", "runtime");
}

export function ap2RuntimePath(relativePath, environment = process.env) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    isAbsolute(relativePath)
  ) {
    throw new Error("AP2 runtime-relative path must be nonempty and relative");
  }
  const root = resolveAp2RuntimeRoot(environment);
  const candidate = resolve(root, relativePath);
  if (candidate === root || !candidate.startsWith(`${root}/`)) {
    throw new Error("AP2 runtime-relative path must stay inside the runtime root");
  }
  return candidate;
}

function absolute(value, label) {
  if (!isAbsolute(value)) throw new Error(`${label} must be absolute`);
  return resolve(value);
}
