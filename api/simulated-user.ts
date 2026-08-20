import { STUDENT_TENANT_ID } from "./identity.js";
import { installation } from "../installation/server.ts";

export interface SimulatedUserIdentity {
  tenantId: string;
  objectId: string;
  displayName: string;
  userPrincipalName: string;
}

export const HOMER_IDENTITY: SimulatedUserIdentity = {
  tenantId: STUDENT_TENANT_ID,
  ...installation.actors.homer,
};

export const CORY_DISPLAY_NAME = installation.actors.cory.displayName;
export const CORY_USER_PRINCIPAL_NAME = installation.actors.cory.userPrincipalName;
export const KOBE_USER_PRINCIPAL_NAME = installation.actors.kobe.userPrincipalName;
export const KOBE_IDENTITY: SimulatedUserIdentity = {
  tenantId: STUDENT_TENANT_ID,
  ...installation.actors.kobe,
};

export function coryIdentity(
  objectId = installation.actors.cory.objectId,
): SimulatedUserIdentity {
  return {
    tenantId: STUDENT_TENANT_ID,
    objectId,
    displayName: CORY_DISPLAY_NAME,
    userPrincipalName: CORY_USER_PRINCIPAL_NAME,
  };
}

export const MARGE_DISPLAY_NAME = installation.actors.marge.displayName;
export const MARGE_USER_PRINCIPAL_NAME = installation.actors.marge.userPrincipalName;
export const MARGE_IDENTITY: SimulatedUserIdentity = {
  tenantId: STUDENT_TENANT_ID,
  ...installation.actors.marge,
};

export interface DelegatedGraphToken {
  token: string;
  identity: {
    tenantId: string;
    objectId: string;
    userPrincipalName: string;
  };
}

export interface DelegatedGraphTokenProvider {
  getToken(scope: string): Promise<DelegatedGraphToken | null>;
}
