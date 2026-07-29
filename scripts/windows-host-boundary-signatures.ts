import type { WindowsHostBoundaryCategory } from "./windows-host-boundary.ts";

function compactForStaticInspection(content: string): string {
  let normalized = content.toLowerCase().replaceAll("\\\\", "/");
  for (let pass = 0; pass < 3; pass += 1) {
    normalized = normalized
      .replace(/\$\{\s*(["'`])([^"'`]*)\1\s*\}/gu, "$2")
      .replace(
        /\[((?:\s*["'`][^"'`]*["'`]\s*,?)+)\]\.join\(\s*["'`]{2}\s*\)/gu,
        (_match, parts: string) => parts.replace(/[\s"'`,]/gu, ""),
      )
      .replace(/(["'`])\s*\+\s*(["'`])/gu, "");
  }
  return normalized.replace(/["'`]/gu, "");
}

function containsAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

const LAUNCH_PRIMITIVES = [
  /\bchild_process\b/u,
  /\bspawn(?:sync)?\b/u,
  /\bexec(?:file|sync|filesync)?\b/u,
  /\bexeca\b/u,
  /\bcross-spawn\b/u,
  /\bdeno\.command\b/u,
  /\bbun\.\$\b/u,
  /\bos\.(?:popen|spawn|startfile|system)\b/u,
  /\bsubprocess\.(?:call|check_call|check_output|popen|run)\b/u,
  /\$\s*`/u,
  /\bshell:true\b/u,
] as const;

const WINDOWS_SHELLS = [
  /powershell(?:\.exe)?/u,
  /pwsh(?:\.exe)?/u,
  /cmd\.exe/u,
  /wscript(?:\.exe)?/u,
  /cscript(?:\.exe)?/u,
  /mshta(?:\.exe)?/u,
] as const;

const APP_PACKAGE_LAUNCH = [
  /wslview/u,
  /explorer\.exe/u,
  /shell:appsfolder/u,
  /ms-windows-store:/u,
  /ms-settings:/u,
  /start-process/u,
  /get-appxpackage/u,
  /applicationframehost(?:\.exe)?/u,
] as const;

const GUI_CONTROL = [
  /appactivate/u,
  /attachthreadinput/u,
  /findwindow(?:ex)?/u,
  /setforegroundwindow/u,
  /showwindow/u,
  /uiautomationclient/u,
  /win32gui/u,
  /wmctrl/u,
  /xdotool/u,
] as const;

const INPUT_AUTOMATION = [
  /get-clipboard/u,
  /getcursorpos/u,
  /keybd_event/u,
  /clipboardy/u,
  /mouse_event/u,
  /nut-js/u,
  /pynput/u,
  /pyautogui/u,
  /robotjs/u,
  /sendkeys/u,
  /set-clipboard/u,
  /setcursorpos/u,
  /wl-copy/u,
  /wl-paste/u,
  /xclip/u,
  /xsel/u,
] as const;

const SESSION_CAPTURE = [
  /bitblt/u,
  /copyfromscreen/u,
  /desktopduplication/u,
  /getwindowdc/u,
  /screenshot-desktop/u,
] as const;

export function categoriesForWindowsHostBoundary(
  content: string,
  path: string,
): WindowsHostBoundaryCategory[] {
  const lower = content.toLowerCase().replaceAll("\\\\", "/");
  const compact = compactForStaticInspection(content);
  const categories = new Set<WindowsHostBoundaryCategory>();
  const hasLaunchPrimitive = containsAny(lower, LAUNCH_PRIMITIVES);
  const commandConfiguration =
    path === "package.json" ||
    path.endsWith("Dockerfile") ||
    path.endsWith(".bat") ||
    path.endsWith(".cmd") ||
    path.endsWith(".ps1") ||
    path.endsWith(".psm1") ||
    path.endsWith(".sh") ||
    path.endsWith(".bash") ||
    path.endsWith(".zsh") ||
    path.startsWith(".github/workflows/");
  const intrinsicWindowsScript =
    /\.(?:bat|cmd|hta|ps1|psm1|vbs|wsf)$/u.test(path);
  const hasWindowsCommandToken =
    /(?:^|[\s=:[(,])(?:process\.env\.)?(?:cmd|comspec)(?:\.exe)?(?=$|[\s/\]),;.])/u.test(
      compact,
    );
  const hasWindowsScriptInvocation =
    commandConfiguration &&
    /(?:^|[\s"'=:,(])[^\s"'=:,()]*\.(?:bat|cmd|hta|ps1|psm1|vbs|wsf)(?=$|[\s"'`,;|&)])/mu.test(
      lower,
    );
  const hasBareWindowsShellLaunch =
    (hasLaunchPrimitive && hasWindowsCommandToken) ||
    (commandConfiguration &&
      (compact.includes("comspec") ||
        /(?:^|[\s"'=:,(])cmd(?:\.exe)?\s+\/[ck]\b/u.test(compact)));

  if (
    compact.includes("wsl_interop") ||
    /\bwsl(?:\.exe)?\b/u.test(compact) ||
    compact.includes("/proc/sys/fs/binfmt_misc/wslinterop")
  ) {
    categories.add("WSL_PROCESS_BRIDGE");
  }
  if (
    containsAny(compact, WINDOWS_SHELLS) ||
    hasBareWindowsShellLaunch ||
    hasWindowsScriptInvocation ||
    intrinsicWindowsScript
  ) {
    categories.add("WINDOWS_SHELL_LAUNCH");
  }
  if (containsAny(compact, APP_PACKAGE_LAUNCH)) {
    categories.add("WINDOWS_APP_PACKAGE_LAUNCH");
  }
  if (containsAny(compact, GUI_CONTROL)) {
    categories.add("SHARED_HOST_GUI_CONTROL");
  }
  if (containsAny(compact, INPUT_AUTOMATION)) {
    categories.add("SHARED_HOST_INPUT_AUTOMATION");
  }
  if (containsAny(compact, SESSION_CAPTURE)) {
    categories.add("SHARED_HOST_SESSION_CAPTURE");
  }

  const hasWindowsExecutable =
    /(?:^|[/:\w.-])[\w.-]+\.exe(?:$|[/:\s"'`,;|&])/u.test(lower) ||
    /[\w.-]+\.exe(?![a-z0-9_])/u.test(compact);
  if (hasWindowsExecutable && (hasLaunchPrimitive || commandConfiguration)) {
    categories.add("WINDOWS_EXECUTABLE_INVOCATION");
  }

  if (
    compact.includes("/mnt/c/") &&
    (hasLaunchPrimitive || commandConfiguration || hasWindowsExecutable)
  ) {
    categories.add("WINDOWS_MOUNT_EXECUTION");
  }

  return [...categories].sort();
}
