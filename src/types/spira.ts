/**
 * Spira data model interfaces representing entities retrieved from the Spira REST API.
 * These types model the template metadata used for mapping validation and import.
 */

export interface TestCasePriority {
  priorityId: number;
  name: string;
  active: boolean;
  score: number;
}

export interface TestCaseStatus {
  testCaseStatusId: number;
  name: string;
  active: boolean;
}

export interface TestCaseType {
  testCaseTypeId: number;
  name: string;
  active: boolean;
  isDefault: boolean;
}

export interface CustomPropertyDefinition {
  customPropertyId: number;
  propertyNumber: number; // 1-30, the slot position
  name: string;
  artifactTypeName: string;
  customPropertyTypeId: number; // 1=Text, 2=Integer, 3=Decimal, 4=Boolean, 5=Date, 6=List, 7=MultiList, 8=User
  customPropertyTypeName: string;
  customListId?: number; // For list/multilist types
  isRequired: boolean;
}

export interface CustomListValue {
  customPropertyValueId: number;
  name: string;
  active: boolean;
}

export interface ProjectUser {
  userId: number;
  fullName: string;
  userName: string;
  active: boolean;
}

export interface Component {
  componentId: number;
  name: string;
  active: boolean;
}

export interface TestCaseFolder {
  testCaseFolderId: number;
  name: string;
  parentTestCaseFolderId?: number;
  indentLevel: string;
}

export interface TemplateMetadata {
  projectId: number;
  templateId: number;
  priorities: TestCasePriority[];
  statuses: TestCaseStatus[];
  types: TestCaseType[];
  customProperties: CustomPropertyDefinition[];
  customLists: Map<number, CustomListValue[]>;
  users: ProjectUser[];
  components: Component[];
  existingFolders: TestCaseFolder[];
}
