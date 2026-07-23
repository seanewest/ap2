import { STUDENT_TENANT_ID } from "./identity.js";

export interface SimulatedUserIdentity {
  tenantId: typeof STUDENT_TENANT_ID;
  objectId: string;
  displayName: string;
  userPrincipalName: string;
}

export const HOMER_IDENTITY: SimulatedUserIdentity = {
  tenantId: STUDENT_TENANT_ID,
  objectId: "6e54e3a9-7651-4520-a331-047550ae6fca",
  displayName: "Homer Simpson",
  userPrincipalName: "homer.simpson@corywest.onmicrosoft.com",
};

export const MARGE_DISPLAY_NAME = "Marge Simpson";
export const MARGE_USER_PRINCIPAL_NAME =
  "marge.simpson@corywest.onmicrosoft.com";

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
