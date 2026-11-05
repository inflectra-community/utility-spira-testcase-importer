/**
 * Spira REST API HTTP client with Base64 authentication, request/response logging,
 * and single retry with 2-second delay for 5xx responses.
 *
 * This module implements the HTTP infrastructure layer of the SpiraApiClient interface.
 * Metadata retrieval and creation methods are added in subsequent tasks.
 */

import type { Logger } from '../logger/index.js';
import type { SpiraConfig } from '../types/config.js';
import type {
  CustomPropertyDefinition,
  CustomListValue,
  TestCasePriority,
  TestCaseStatus,
  TestCaseType,
  ProjectUser,
  Component,
  TestCaseFolder,
} from '../types/spira.js';
import type {
  CreateFolderRequest,
  CreateTestCaseRequest,
  CreateTestStepRequest,
  CreateTestSetRequest,
  CreateTestSetFolderRequest,
  TestSetFolder,
  TestSetTestCaseMapping,
} from '../types/import.js';

/** Spira ArtifactTypeId for Test Cases (used when creating custom properties). */
export const ARTIFACT_TYPE_TEST_CASE = 2;

/**
 * Input for creating a new custom property on an artifact type.
 * For list/multilist types, pass the customListId the property binds to.
 */
export interface CreateCustomPropertyInput {
  name: string;
  /** Spira custom property type: 1=Text, 2=Integer, 6=List, 7=MultiList, etc. */
  customPropertyTypeId: number;
  /** Required for list (6) and multilist (7) types. */
  customListId?: number;
  artifactTypeName?: string;
  artifactTypeId?: number;
}

/**
 * Response from the Spira project endpoint used for authentication validation.
 */
interface ProjectResponse {
  ProjectGroupId?: number;
  ProjectId: number;
  Name: string;
  ProjectTemplateId: number;
}

/**
 * Represents a structured Spira API error with status code and message.
 */
export class SpiraApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly url: string,
    public readonly method: string,
  ) {
    super(message);
    this.name = 'SpiraApiError';
  }
}

/**
 * Full SpiraApiClient interface as defined in the design document.
 * Methods beyond authenticate() are stubbed and implemented in later tasks.
 */
export interface SpiraApiClient {
  authenticate(): Promise<void>;
  /** The project's template id, resolved during authenticate(). Throws if called before. */
  getTemplateId(): number;
  /** Product (project) name and its program name, as Spira knows them. */
  getProjectInfo(): Promise<{ productName: string; programName?: string }>;
  getCustomProperties(artifactTypeName: string): Promise<CustomPropertyDefinition[]>;
  getCustomListValues(customListId: number): Promise<CustomListValue[]>;
  /** Adds one or more values to an existing custom list. Returns the values created. */
  addCustomListValues(customListId: number, names: string[]): Promise<CustomListValue[]>;
  /** Creates a new custom list (optionally seeded with values) and returns its id. */
  createCustomList(name: string, values: string[]): Promise<{ customListId: number }>;
  /** Creates a new custom property on an artifact type. Returns its property number. */
  createCustomProperty(input: CreateCustomPropertyInput): Promise<CustomPropertyDefinition>;
  getTestCasePriorities(): Promise<TestCasePriority[]>;
  getTestCaseStatuses(): Promise<TestCaseStatus[]>;
  getTestCaseTypes(): Promise<TestCaseType[]>;
  getProjectUsers(): Promise<ProjectUser[]>;
  getComponents(): Promise<Component[]>;
  /** Creates a new active component in the project. Returns the created component. */
  createComponent(name: string): Promise<Component>;
  getTestFolders(): Promise<TestCaseFolder[]>;
  createTestFolder(folder: CreateFolderRequest): Promise<TestCaseFolder>;
  createTestCase(testCase: CreateTestCaseRequest): Promise<{ TestCaseId: number }>;
  addTestSteps(testCaseId: number, steps: CreateTestStepRequest[]): Promise<void>;
  uploadDocument(document: Record<string, unknown>): Promise<{ DocumentId: number }>;
  getTestSetFolders(): Promise<TestSetFolder[]>;
  createTestSetFolder(folder: CreateTestSetFolderRequest): Promise<TestSetFolder>;
  createTestSet(testSet: CreateTestSetRequest): Promise<{ TestSetId: number }>;
  addTestCaseToSet(testSetId: number, testCaseId: number): Promise<void>;
  getTestCaseMappings(testSetId: number): Promise<TestSetTestCaseMapping[]>;
  updateTestCaseMapping(testSetId: number, mapping: TestSetTestCaseMapping): Promise<void>;
}

/**
 * Delay helper for retry logic.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Constructs the Base64-encoded Authorization header value from username and API key.
 * Format: "Basic " + base64("username:apiKey")
 */
export function buildAuthHeader(username: string, apiKey: string): string {
  const credentials = `${username}:${apiKey}`;
  const encoded = Buffer.from(credentials, 'utf-8').toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Creates a Spira API client instance configured with the given credentials and logger.
 *
 * The client:
 * - Constructs a Base64 auth header from username:apiKey
 * - Logs every request/response via the Logger's apiRequest method
 * - Retries once with a 2-second delay on 5xx server errors
 * - Throws SpiraApiError for non-2xx responses (after retry exhaustion for 5xx)
 */
export function createSpiraClient(config: SpiraConfig, logger: Logger): SpiraApiClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const apiBase = `${baseUrl}/services/v7_0/RestService.svc`;
  const authHeader = buildAuthHeader(config.username, config.apiKey);

  /**
   * Core HTTP request method with logging and 5xx retry.
   */
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${apiBase}${path}`;
    const headers: Record<string, string> = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    };

    logger.info(`${method} ${path}`, { url });

    let response: Response;
    let startTime = Date.now();

    try {
      startTime = Date.now();
      response = await fetch(url, fetchOptions);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.apiRequest(method, url, 0, duration);
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Network error: ${errorMessage}`, { url, method });
      throw new SpiraApiError(`Network error connecting to Spira: ${errorMessage}`, 0, url, method);
    }

    const duration = Date.now() - startTime;
    logger.apiRequest(method, url, response.status, duration);

    // Retry once on 5xx server errors
    if (response.status >= 500) {
      logger.warn(`Server error ${response.status}, retrying in 2 seconds...`, {
        url,
        method,
        statusCode: response.status,
      });

      await delay(2000);

      let retryStartTime = Date.now();
      try {
        retryStartTime = Date.now();
        response = await fetch(url, fetchOptions);
      } catch (err) {
        const retryDuration = Date.now() - retryStartTime;
        logger.apiRequest(method, url, 0, retryDuration);
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error(`Network error on retry: ${errorMessage}`, { url, method });
        throw new SpiraApiError(
          `Network error connecting to Spira on retry: ${errorMessage}`,
          0,
          url,
          method,
        );
      }

      const retryDuration = Date.now() - retryStartTime;
      logger.apiRequest(method, url, response.status, retryDuration);
    }

    // Handle non-2xx responses
    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // Ignore read errors on error response body
      }

      const errorMessage = buildErrorMessage(response.status, method, path, errorBody);
      logger.error(errorMessage, { statusCode: response.status, url, method, errorBody });
      throw new SpiraApiError(errorMessage, response.status, url, method);
    }

    // Parse successful response
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      logger.error('Failed to parse JSON response', { url, method, responseText: text.slice(0, 200) });
      throw new SpiraApiError('Invalid JSON response from Spira API', response.status, url, method);
    }
  }

  /**
   * Constructs a user-friendly error message based on status code.
   */
  function buildErrorMessage(
    statusCode: number,
    method: string,
    path: string,
    body: string,
  ): string {
    switch (statusCode) {
      case 401:
        return 'Authentication failed: invalid username or API key';
      case 403:
        return 'Access denied: insufficient permissions for the requested resource';
      case 404:
        return `Resource not found: ${method} ${path}`;
      default:
        return `Spira API error (${statusCode}): ${method} ${path}${body ? ` — ${body.slice(0, 200)}` : ''}`;
    }
  }

  // Stored after authenticate() — needed for template-scoped API calls.
  let templateId: number | null = null;

  /**
   * Returns the stored templateId, throwing if authenticate() hasn't been called yet.
   */
  function getTemplateId(): number {
    if (templateId === null) {
      throw new Error('Template ID not available. Call authenticate() first.');
    }
    return templateId;
  }

  /**
   * Validates the connection by retrieving the project details.
   * Stores the ProjectTemplateId for use in subsequent metadata calls.
   * Throws SpiraApiError if credentials are invalid or the project doesn't exist.
   */
  async function authenticate(): Promise<void> {
    logger.info('Authenticating against Spira instance...', {
      baseUrl,
      projectId: config.projectId,
    });

    const project = await request<ProjectResponse>(
      'GET',
      `/projects/${config.projectId}`,
    );

    templateId = project.ProjectTemplateId;
    logger.info(`Successfully authenticated. Project: "${project.Name}" (ID: ${project.ProjectId}, Template: ${templateId})`);
  }

  /**
   * Returns the product name and the name of the program it belongs to.
   * The program lookup is best-effort: some accounts can't read /programs,
   * in which case only the product name is returned.
   */
  async function getProjectInfo(): Promise<{ productName: string; programName?: string }> {
    const project = await request<ProjectResponse>('GET', `/projects/${config.projectId}`);
    let programName: string | undefined;
    if (project.ProjectGroupId) {
      try {
        const program = await request<{ Name?: string }>('GET', `/programs/${project.ProjectGroupId}`);
        programName = program?.Name;
      } catch {
        logger.warn('Could not read the program name from Spira; it must be entered manually.');
      }
    }
    return { productName: project.Name, programName };
  }

  /**
   * Retrieves custom property definitions for a given artifact type from the project template.
   */
  async function getCustomProperties(artifactTypeName: string): Promise<CustomPropertyDefinition[]> {
    const tid = getTemplateId();
    return request<CustomPropertyDefinition[]>(
      'GET',
      `/project-templates/${tid}/custom-properties/${artifactTypeName}`,
    );
  }

  /**
   * Retrieves the values for a specific custom list from the project template.
   */
  async function getCustomListValues(customListId: number): Promise<CustomListValue[]> {
    const tid = getTemplateId();
    return request<CustomListValue[]>(
      'GET',
      `/project-templates/${tid}/custom-lists/${customListId}`,
    );
  }

  /**
   * Adds values to an existing custom list, one POST per value.
   * POST /project-templates/{tid}/custom-lists/{custom_list_id}/values
   * Returns the created value rows.
   */
  async function addCustomListValues(customListId: number, names: string[]): Promise<CustomListValue[]> {
    const tid = getTemplateId();
    const created: CustomListValue[] = [];
    for (const name of names) {
      const raw = await request<any>(
        'POST',
        `/project-templates/${tid}/custom-lists/${customListId}/values`,
        { CustomPropertyListId: customListId, Name: name, Active: true },
      );
      created.push({
        customPropertyValueId: raw?.CustomPropertyValueId ?? raw?.customPropertyValueId,
        name: raw?.Name ?? raw?.name ?? name,
        active: raw?.Active ?? raw?.active ?? true,
      });
    }
    return created;
  }

  /**
   * Creates a new custom list, seeded with the given values.
   * POST /project-templates/{tid}/custom-lists
   */
  async function createCustomList(name: string, values: string[]): Promise<{ customListId: number }> {
    const tid = getTemplateId();
    const raw = await request<any>(
      'POST',
      `/project-templates/${tid}/custom-lists`,
      {
        ProjectTemplateId: tid,
        Name: name,
        Active: true,
        Values: values.map(v => ({ Name: v, Active: true })),
      },
    );
    return { customListId: raw?.CustomPropertyListId ?? raw?.customPropertyListId };
  }

  /**
   * Creates a new custom property on an artifact type (default: Test Case).
   * POST /project-templates/{tid}/custom-properties
   */
  async function createCustomProperty(input: CreateCustomPropertyInput): Promise<CustomPropertyDefinition> {
    const tid = getTemplateId();
    const artifactTypeName = input.artifactTypeName ?? 'TestCase';
    const body: Record<string, unknown> = {
      ProjectTemplateId: tid,
      ArtifactTypeId: input.artifactTypeId ?? ARTIFACT_TYPE_TEST_CASE,
      Name: input.name,
      CustomPropertyTypeId: input.customPropertyTypeId,
    };
    // List/multilist properties must reference their backing list.
    if (input.customListId != null) {
      body.CustomList = { CustomPropertyListId: input.customListId };
    }
    // POST takes no artifact-type path segment — ArtifactTypeId in the body selects it.
    const raw = await request<any>(
      'POST',
      `/project-templates/${tid}/custom-properties`,
      body,
    );
    return {
      customPropertyId: raw?.CustomPropertyId ?? raw?.customPropertyId,
      propertyNumber: raw?.PropertyNumber ?? raw?.propertyNumber,
      name: raw?.Name ?? raw?.name ?? input.name,
      artifactTypeName,
      customPropertyTypeId: raw?.CustomPropertyTypeId ?? input.customPropertyTypeId,
      customPropertyTypeName: raw?.CustomPropertyTypeName ?? '',
      customListId: raw?.CustomList?.CustomPropertyListId ?? input.customListId,
      isRequired: raw?.IsRequired ?? false,
    };
  }

  /**
   * Retrieves all test case priority definitions from the project template.
   */
  async function getTestCasePriorities(): Promise<TestCasePriority[]> {
    const tid = getTemplateId();
    return request<TestCasePriority[]>(
      'GET',
      `/project-templates/${tid}/test-cases/priorities`,
    );
  }

  /**
   * Retrieves all test case status definitions from the project template.
   */
  async function getTestCaseStatuses(): Promise<TestCaseStatus[]> {
    const tid = getTemplateId();
    return request<TestCaseStatus[]>(
      'GET',
      `/project-templates/${tid}/test-cases/statuses`,
    );
  }

  /**
   * Retrieves all test case type definitions from the project template.
   */
  async function getTestCaseTypes(): Promise<TestCaseType[]> {
    const tid = getTemplateId();
    return request<TestCaseType[]>(
      'GET',
      `/project-templates/${tid}/test-cases/types`,
    );
  }

  /**
   * Retrieves all users assigned to the project.
   */
  async function getProjectUsers(): Promise<ProjectUser[]> {
    return request<ProjectUser[]>(
      'GET',
      `/projects/${config.projectId}/users`,
    );
  }

  /**
   * Retrieves all components defined in the project.
   */
  async function getComponents(): Promise<Component[]> {
    return request<Component[]>(
      'GET',
      `/projects/${config.projectId}/components?active_only=true&include_deleted=false`,
    );
  }

  /**
   * Creates a new active component in the project.
   * POST /projects/{project_id}/components
   */
  async function createComponent(name: string): Promise<Component> {
    const raw = await request<any>(
      'POST',
      `/projects/${config.projectId}/components`,
      { ProjectId: config.projectId, Name: name, IsActive: true },
    );
    return {
      componentId: raw?.ComponentId ?? raw?.componentId,
      name: raw?.Name ?? raw?.name ?? name,
      active: raw?.IsActive ?? raw?.isActive ?? true,
    };
  }

  /**
   * Retrieves all test case folders in the project.
   */
  async function getTestFolders(): Promise<TestCaseFolder[]> {
    return request<TestCaseFolder[]>(
      'GET',
      `/projects/${config.projectId}/test-folders`,
    );
  }

  /**
   * Creates a new test case in the project.
   * POST /projects/{project_id}/test-cases
   */
  async function createTestCase(testCase: CreateTestCaseRequest): Promise<{ TestCaseId: number }> {
    const raw = await request<any>(
      'POST',
      `/projects/${config.projectId}/test-cases`,
      testCase,
    );
    return { TestCaseId: raw.TestCaseId ?? raw.testCaseId };
  }

  /**
   * Adds multiple test steps to an existing test case.
   * POST /projects/{project_id}/test-cases/{id}/test-steps/multiple
   */
  async function addTestSteps(testCaseId: number, steps: CreateTestStepRequest[]): Promise<void> {
    await request<unknown>(
      'POST',
      `/projects/${config.projectId}/test-cases/${testCaseId}/test-steps/multiple`,
      steps,
    );
  }

  /**
   * Creates a new test case folder in the project.
   * POST /projects/{project_id}/test-folders
   */
  async function createTestFolder(folder: CreateFolderRequest): Promise<TestCaseFolder> {
    const raw = await request<any>(
      'POST',
      `/projects/${config.projectId}/test-folders`,
      folder,
    );
    return {
      testCaseFolderId: raw.TestCaseFolderId ?? raw.testCaseFolderId,
      name: raw.Name ?? raw.name,
      parentTestCaseFolderId: raw.ParentTestCaseFolderId ?? raw.parentTestCaseFolderId,
      indentLevel: raw.IndentLevel ?? raw.indentLevel ?? '0',
    };
  }

  /**
   * Retrieves all test set folders in the project.
   * GET /projects/{project_id}/test-set-folders
   */
  async function getTestSetFolders(): Promise<TestSetFolder[]> {
    const raw = await request<any[]>(
      'GET',
      `/projects/${config.projectId}/test-set-folders`,
    );
    return (raw ?? []).map(f => ({
      testSetFolderId: f.TestSetFolderId ?? f.testSetFolderId,
      name: f.Name ?? f.name,
      parentTestSetFolderId: f.ParentTestSetFolderId ?? f.parentTestSetFolderId,
      indentLevel: f.IndentLevel ?? f.indentLevel ?? '0',
    }));
  }

  /**
   * Creates a new test set folder in the project.
   * POST /projects/{project_id}/test-set-folders
   */
  async function createTestSetFolder(folder: CreateTestSetFolderRequest): Promise<TestSetFolder> {
    const raw = await request<any>(
      'POST',
      `/projects/${config.projectId}/test-set-folders`,
      folder,
    );
    return {
      testSetFolderId: raw.TestSetFolderId ?? raw.testSetFolderId,
      name: raw.Name ?? raw.name,
      parentTestSetFolderId: raw.ParentTestSetFolderId ?? raw.parentTestSetFolderId,
      indentLevel: raw.IndentLevel ?? raw.indentLevel ?? '0',
    };
  }

  /**
   * Creates a new test set in the project.
   * POST /projects/{project_id}/test-sets
   */
  async function createTestSet(testSet: CreateTestSetRequest): Promise<{ TestSetId: number }> {
    const raw = await request<any>(
      'POST',
      `/projects/${config.projectId}/test-sets`,
      testSet,
    );
    return { TestSetId: raw.TestSetId ?? raw.testSetId };
  }

  /**
   * Maps a test case into a test set.
   * POST /projects/{project_id}/test-sets/{test_set_id}/test-case-mapping/{test_case_id}
   *
   * Note: Position cannot be set here — use updateTestCaseMappings() afterward for ordering.
   * The endpoint expects an array body (may be empty).
   */
  async function addTestCaseToSet(testSetId: number, testCaseId: number): Promise<void> {
    await request<unknown>(
      'POST',
      `/projects/${config.projectId}/test-sets/${testSetId}/test-case-mapping/${testCaseId}`,
      [],
    );
  }

  /**
   * Retrieves the test case mappings for a test set.
   * GET /projects/{project_id}/test-sets/{test_set_id}/test-case-mapping
   */
  async function getTestCaseMappings(testSetId: number): Promise<TestSetTestCaseMapping[]> {
    const raw = await request<any[]>(
      'GET',
      `/projects/${config.projectId}/test-sets/${testSetId}/test-case-mapping`,
    );
    return (raw ?? []).map(m => ({
      TestSetTestCaseId: m.TestSetTestCaseId ?? m.testSetTestCaseId,
      TestSetId: m.TestSetId ?? m.testSetId,
      TestCaseId: m.TestCaseId ?? m.testCaseId,
      Position: m.Position ?? m.position,
      OwnerId: m.OwnerId ?? m.ownerId,
      IsSetupTeardown: m.IsSetupTeardown ?? m.isSetupTeardown,
    }));
  }

  /**
   * Updates a single test case mapping for a test set (used to set execution order via Position).
   * PUT /projects/{project_id}/test-sets/{test_set_id}/test-case-mapping
   *
   * The endpoint takes a SINGLE RemoteTestSetTestCaseMapping object (not an array).
   * Note: if the Position value is already in use by another mapping, Spira ignores
   * the change — so callers should sequence updates to avoid transient collisions.
   */
  async function updateTestCaseMapping(testSetId: number, mapping: TestSetTestCaseMapping): Promise<void> {
    await request<unknown>(
      'PUT',
      `/projects/${config.projectId}/test-sets/${testSetId}/test-case-mapping`,
      mapping,
    );
  }

  /**
   * Uploads a document (file attachment) to the project.
   * POST /projects/{project_id}/documents/file
   */
  async function uploadDocument(document: Record<string, unknown>): Promise<{ DocumentId: number }> {
    const raw = await request<any>(
      'POST',
      `/projects/${config.projectId}/documents/file`,
      document,
    );
    return { DocumentId: raw.DocumentId ?? raw.documentId };
  }

  return {
    authenticate,
    getTemplateId,
    getProjectInfo,
    getCustomProperties,
    getCustomListValues,
    addCustomListValues,
    createCustomList,
    createCustomProperty,
    getTestCasePriorities,
    getTestCaseStatuses,
    getTestCaseTypes,
    getProjectUsers,
    getComponents,
    createComponent,
    getTestFolders,
    createTestFolder,
    createTestCase,
    addTestSteps,
    uploadDocument,
    getTestSetFolders,
    createTestSetFolder,
    createTestSet,
    addTestCaseToSet,
    getTestCaseMappings,
    updateTestCaseMapping,
  };
}
