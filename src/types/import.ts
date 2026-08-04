/**
 * Import-related interfaces for the import engine, covering API request bodies,
 * import results, and failure tracking.
 */

export interface ImportResult {
  totalAttempted: number;
  successCount: number;
  failureCount: number;
  failures: ImportFailure[];
  createdFolders: string[];
  duration: number; // milliseconds
}

export interface ImportFailure {
  sourceRowIndex: number;
  testCaseName: string;
  error: string;
  phase: 'folder' | 'testcase' | 'teststep';
}

export interface CreateTestCaseRequest {
  Name: string;
  Description?: string;
  TestCaseStatusId: number; // Required — use 0 for default
  TestCaseTypeId?: number; // Pass null to use default
  TestCasePriorityId?: number;
  OwnerId?: number;
  TestCaseFolderId?: number; // null = root folder
  ComponentIds?: number[];
  Tags?: string;
  CustomProperties?: RemoteCustomProperty[];
}

export interface CreateTestStepRequest {
  Description: string;
  ExpectedResult?: string;
  SampleData?: string;
  Position: number;
}

export interface CreateFolderRequest {
  Name: string;
  ParentTestCaseFolderId?: number; // null = root
}

export interface RemoteCustomProperty {
  PropertyNumber: number;
  StringValue?: string;
  IntegerValue?: number;
  BooleanValue?: boolean;
  DateTimeValue?: string;
  IntegerListValue?: number[];
}
