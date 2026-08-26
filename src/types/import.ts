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
  /** Maps source row index to created Spira test case ID (for post-import operations like attachments) */
  createdTestCases: Map<number, number>;
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

// --- Test Set request/response types ---

export interface CreateTestSetRequest {
  Name: string;
  Description?: string;
  TestSetStatusId: number; // 1-5 (1=Not Started, 2=Planned, 3=In Progress, 4=Completed, 5=Blocked)
  TestRunTypeId: number; // 1=Manual, 2=Automated
  TestSetFolderId?: number; // null = root
  ReleaseId?: number;
}

export interface CreateTestSetFolderRequest {
  Name: string;
  ParentTestSetFolderId?: number; // null = root
}

export interface TestSetFolder {
  testSetFolderId: number;
  name: string;
  parentTestSetFolderId?: number;
  indentLevel: string;
}

/**
 * Mapping of a test case into a test set (RemoteTestSetTestCaseMapping).
 * Position controls execution order within the set.
 */
export interface TestSetTestCaseMapping {
  TestSetTestCaseId?: number;
  TestSetId: number;
  TestCaseId: number;
  Position?: number;
  OwnerId?: number;
  IsSetupTeardown?: boolean;
}

export interface RemoteCustomProperty {
  PropertyNumber: number;
  StringValue?: string;
  IntegerValue?: number;
  BooleanValue?: boolean;
  DateTimeValue?: string;
  IntegerListValue?: number[];
}
