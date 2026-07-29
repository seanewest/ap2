import { OAUTH_APPLICATION_RECON_SCENARIO } from "./oauth-application-recon";
import { TEAMS_MISSED_CALL_SCENARIO } from "./teams-missed-call";

export const SCENARIO_MANIFESTS = [
  TEAMS_MISSED_CALL_SCENARIO,
  OAUTH_APPLICATION_RECON_SCENARIO,
] as const;
