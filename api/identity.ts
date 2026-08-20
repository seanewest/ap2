import { installation } from "../installation/server.ts";
export {
  AFTER_PARTY_CLIENT_ID,
  PRODUCT_TENANT_ID,
  REQUIRED_APPLICATION_ROLE,
  REQUIRED_DELEGATED_SCOPE,
} from "../product-identity.ts";

export const STUDENT_TENANT_ID = installation.student.tenantId;
export const STUDENT_DELEGATED_USER_OBJECT_IDS =
  installation.student.delegatedOperatorObjectIds;
export const STUDENT_PRODUCT_OPERATOR_OBJECT_ID =
  STUDENT_DELEGATED_USER_OBJECT_IDS[0]!;
export const STUDENT_CBA_TEST_OPERATOR_OBJECT_ID =
  STUDENT_DELEGATED_USER_OBJECT_IDS[1]!;
export const DEVELOPMENT_AUTOMATION_CLIENT_ID =
  installation.student.automationClientId;
