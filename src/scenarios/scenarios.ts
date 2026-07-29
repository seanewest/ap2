import { AVD_THREE_VM_SCENARIO } from "./avd-three-vm";
import { HELP_DESK_EMAIL_SCENARIO } from "./help-desk-email";
import { OAUTH_APPLICATION_RECON_SCENARIO } from "./oauth-application-recon";
import { TEAMS_MISSED_CALL_SCENARIO } from "./teams-missed-call";

export const SCENARIO_MANIFESTS = [
  TEAMS_MISSED_CALL_SCENARIO,
  HELP_DESK_EMAIL_SCENARIO,
  AVD_THREE_VM_SCENARIO,
  OAUTH_APPLICATION_RECON_SCENARIO,
] as const;
