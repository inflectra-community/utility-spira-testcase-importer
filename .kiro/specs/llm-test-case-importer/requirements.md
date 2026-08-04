# Requirements Document

## Introduction

The LLM Test Case Importer is a Node.js/TypeScript tool that enables Spira customers to import test cases from Excel spreadsheets by leveraging a customer-chosen LLM to handle the data mapping between arbitrary Excel formats and Spira's data model. The tool retrieves template metadata (custom properties, list values) from a target Spira instance, uses an LLM to reconcile customer test case data to the expected Spira format, and then safely injects the mapped data via the Spira REST API.

## Glossary

- **Importer**: The LLM Test Case Importer application
- **Spira**: The Inflectra Spira application lifecycle management platform (SpiraTest, SpiraTeam, or SpiraPlan)
- **Spira_REST_API**: The REST API exposed by a Spira instance for programmatic access to project data
- **Template**: A Spira project template that defines custom properties, custom list values, and field configurations for test cases
- **Custom_Property**: A user-defined field on a Spira artifact (e.g., a test case) configured at the template level
- **Custom_List**: A set of named values associated with a custom property of type "list" in Spira
- **Test_Case**: A Spira artifact representing a test case, containing fields such as name, description, priority, owner, steps, and custom properties
- **Test_Step**: A sub-element of a Test_Case representing a single step with description, expected result, and sample data
- **Source_Spreadsheet**: The customer-provided Excel file containing test case data in an arbitrary format
- **LLM_Provider**: The customer-chosen large language model service used for data mapping (e.g., OpenAI, Anthropic, AWS Bedrock)
- **Mapping_Result**: The structured output produced by the LLM_Provider that maps source data to Spira's test case model
- **Mapping_Validation_Report**: A report generated after data transformation that presents the user with a summary of mapped data, sample records, validation errors, and warnings for go/no-go approval
- **Import_Session**: A single execution of the import process from source data extraction through REST API injection

## Requirements

### Requirement 1: Spira Connection and Authentication

**User Story:** As a user, I want to connect to my Spira instance securely, so that the Importer can retrieve template data and inject test cases.

#### Acceptance Criteria

1. WHEN connection credentials are provided, THE Importer SHALL authenticate against the Spira_REST_API and confirm the connection is valid
2. THE Importer SHALL support authentication using a Spira API key and base URL
3. IF authentication fails, THEN THE Importer SHALL return a descriptive error message indicating the cause of failure
4. THE Importer SHALL store connection credentials only in memory or in local environment variables during an Import_Session

### Requirement 2: Template Metadata Retrieval

**User Story:** As a user, I want the Importer to retrieve my project's template configuration from Spira, so that the LLM has the complete schema to map data against.

#### Acceptance Criteria

1. WHEN a valid connection is established, THE Importer SHALL retrieve all Custom_Property definitions for Test_Cases from the specified Spira project
2. WHEN a valid connection is established, THE Importer SHALL retrieve all Custom_List values associated with Test_Case Custom_Properties
3. WHEN a valid connection is established, THE Importer SHALL retrieve standard Test_Case field metadata including priorities, statuses, types, and component lists
4. THE Importer SHALL retrieve owner/user lists available for assignment in the specified project
5. IF template retrieval fails for any field set, THEN THE Importer SHALL report which specific metadata could not be retrieved and continue retrieving remaining metadata

### Requirement 3: Source Spreadsheet Parsing

**User Story:** As a user, I want to provide my test case data in Excel format, so that the Importer can extract the raw data for LLM-assisted mapping.

#### Acceptance Criteria

1. WHEN a Source_Spreadsheet file path is provided, THE Importer SHALL parse the Excel file and extract all worksheet data
2. THE Importer SHALL support .xlsx and .xls file formats
3. THE Importer SHALL preserve the original column headers, row data, and sheet structure during extraction
4. IF the Source_Spreadsheet cannot be read or parsed, THEN THE Importer SHALL return a descriptive error indicating the file issue
5. WHEN a Source_Spreadsheet contains multiple worksheets, THE Importer SHALL allow the user to select which worksheets contain test case data

### Requirement 4: LLM Provider Configuration

**User Story:** As a user, I want to configure my preferred LLM provider, so that the Importer uses my chosen model for data mapping.

#### Acceptance Criteria

1. THE Importer SHALL support configuration of at least the following LLM_Providers: OpenAI, Anthropic, and AWS Bedrock
2. WHEN an LLM_Provider is configured, THE Importer SHALL validate that the provided API credentials are functional before proceeding with mapping
3. THE Importer SHALL allow the user to specify the model name or identifier for the chosen LLM_Provider
4. IF LLM_Provider credentials are invalid, THEN THE Importer SHALL return a descriptive error indicating the authentication failure
5. THE Importer SHALL store LLM_Provider credentials only in memory or in local environment variables during an Import_Session

### Requirement 5: LLM-Assisted Data Mapping

**User Story:** As a user, I want the LLM to map my spreadsheet columns and values to Spira's test case data model, so that I do not have to manually transform my data.

#### Acceptance Criteria

1. WHEN Source_Spreadsheet data and Template metadata are available, THE Importer SHALL send the column headers, sample rows, and Spira schema to the LLM_Provider for mapping analysis
2. THE Importer SHALL construct an LLM prompt that includes the Spira Test_Case field definitions, Custom_Property definitions, Custom_List values, and source column headers with sample data
3. WHEN the LLM_Provider returns a Mapping_Result, THE Importer SHALL parse the structured response into field-to-field mappings and value transformations
4. THE Importer SHALL present the proposed Mapping_Result to the user for review before proceeding with the import
5. WHEN a user modifies the proposed Mapping_Result, THE Importer SHALL apply the user's corrections to the final mapping
6. IF the LLM_Provider fails to return a valid Mapping_Result, THEN THE Importer SHALL report the error and allow the user to retry or adjust the prompt
7. THE Importer SHALL map source data values to corresponding Custom_List values in the Spira template where applicable

### Requirement 6: Data Transformation, Validation, and Approval

**User Story:** As a user, I want the mapped data to be validated and presented to me for approval before import, so that I can review the final results and give a go/no-go decision before data is injected into Spira.

#### Acceptance Criteria

1. WHEN a Mapping_Result is confirmed, THE Importer SHALL transform all Source_Spreadsheet rows into Spira Test_Case objects using the confirmed mapping
2. THE Importer SHALL validate that all required Spira Test_Case fields are populated after transformation
3. THE Importer SHALL validate that mapped Custom_List values match valid entries in the retrieved Template metadata
4. IF validation detects errors in transformed data, THEN THE Importer SHALL report each error with the source row number and field name
5. WHEN transformation and validation are complete, THE Importer SHALL generate a Mapping_Validation_Report showing: the total count of test cases to be created, sample transformed records, the count and details of validation errors, the count of warnings, and a summary of field mappings applied
6. THE Importer SHALL present the Mapping_Validation_Report to the user and require explicit approval before proceeding to data injection
7. IF the user rejects the Mapping_Validation_Report, THEN THE Importer SHALL allow the user to return to the mapping step to adjust the Mapping_Result
8. THE Importer SHALL not send any data to the Spira_REST_API until the user has approved the Mapping_Validation_Report

### Requirement 7: Test Case Import via REST API

**User Story:** As a user, I want the validated test cases injected into Spira via the REST API, so that my data appears correctly in my project.

#### Acceptance Criteria

1. WHEN validated Test_Case data is ready, THE Importer SHALL create each Test_Case in the specified Spira project via the Spira_REST_API
2. WHEN a Test_Case includes Test_Steps, THE Importer SHALL create each Test_Step associated with the parent Test_Case via the Spira_REST_API
3. THE Importer SHALL set Custom_Property values on each created Test_Case according to the confirmed Mapping_Result
4. IF a Test_Case creation fails via the Spira_REST_API, THEN THE Importer SHALL log the failure with the source row reference and continue processing remaining test cases
5. WHEN the import completes, THE Importer SHALL produce a summary report listing the count of successfully created test cases, the count of failures, and the details of each failure
6. THE Importer SHALL support a dry-run mode that validates and transforms data without sending requests to the Spira_REST_API

### Requirement 8: Test Case Folder Hierarchy

**User Story:** As a user, I want to preserve or define folder structure for imported test cases, so that they are organized within Spira.

#### Acceptance Criteria

1. WHEN the Source_Spreadsheet contains a column mapped to folder path, THE Importer SHALL create the corresponding folder hierarchy in Spira before importing Test_Cases
2. THE Importer SHALL assign each imported Test_Case to the folder specified by the mapping
3. IF a folder already exists in the Spira project, THEN THE Importer SHALL reuse the existing folder rather than creating a duplicate
4. WHEN no folder mapping is provided, THE Importer SHALL place all imported Test_Cases at the root level of the test case tree

### Requirement 9: Import Progress and Logging

**User Story:** As a user, I want to see progress and detailed logs during import, so that I can monitor the operation and troubleshoot issues.

#### Acceptance Criteria

1. WHILE an Import_Session is in progress, THE Importer SHALL display the current progress as a count of processed items relative to total items
2. THE Importer SHALL log each Spira_REST_API request and response status during the Import_Session
3. WHEN an Import_Session completes, THE Importer SHALL persist the full log to a file in the working directory
4. IF the Import_Session is interrupted, THEN THE Importer SHALL log which test cases were successfully imported and which remain unprocessed
