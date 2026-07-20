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
} from '../types/import.js';

/**
 * Response from the Spira project endpoint used for authentication validation.
 */
interface ProjectResponse {
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
  getCustomProperties(artifactTypeName: string): Promise<CustomPropertyDefinition[]>;
  getCustomListValues(customListId: number): Promise<CustomListValue[]>;
  getTestCasePriorities(): Promise<TestCasePriority[]>;
  getTestCaseStatuses(): Promise<TestCaseStatus[]>;
  getTestCaseTypes(): Promise<TestCaseType[]>;
  getProjectUsers(): Promise<ProjectUser[]>;
  getComponents(): Promise<Component[]>;
  getTestFolders(): Promise<TestCaseFolder[]>;
  createTestFolder(folder: CreateFolderRequest): Promise<TestCaseFolder>;
  createTestCase(testCase: CreateTestCaseRequest): Promise<{ TestCaseId: number }>;
  addTestSteps(testCaseId: number, steps: CreateTestStepRequest[]): Promise<void>;
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
    return request<{ TestCaseId: number }>(
      'POST',
      `/projects/${config.projectId}/test-cases`,
      testCase,
    );
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
    return request<TestCaseFolder>(
      'POST',
      `/projects/${config.projectId}/test-folders`,
      folder,
    );
  }

  return {
    authenticate,
    getCustomProperties,
    getCustomListValues,
    getTestCasePriorities,
    getTestCaseStatuses,
    getTestCaseTypes,
    getProjectUsers,
    getComponents,
    getTestFolders,
    createTestFolder,
    createTestCase,
    addTestSteps,
  };
}
