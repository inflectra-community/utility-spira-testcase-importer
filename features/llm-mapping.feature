Feature: LLM-Assisted Data Mapping
  As a user
  I want the LLM to map my spreadsheet columns to Spira's test case model
  So that I do not have to manually transform my data

  Background:
    Given template metadata has been retrieved from Spira
    And a spreadsheet has been parsed with column headers and sample data

  Scenario: LLM receives complete context for mapping
    When the Importer constructs the mapping prompt
    Then the prompt should contain all source column headers
    And the prompt should contain all Spira test case field definitions
    And the prompt should contain all custom property names from the template
    And the prompt should contain all active custom list value names
    And the prompt should contain sample data rows from the source

  Scenario: LLM produces a valid structured mapping result
    When the LLM generates a mapping
    Then the result should contain field-to-field mappings
    And each mapping should specify a source column and target field
    And each mapping should specify a transform type
    And the result should list any unmapped source columns
    And the result should include a confidence score between 0 and 1

  Scenario: User reviews and accepts the proposed mapping
    Given the LLM has generated a mapping result
    When the mapping is presented to the user
    And the user accepts the mapping
    Then the pipeline should proceed to transformation

  Scenario: User provides feedback to revise the mapping
    Given the LLM has generated a mapping result
    When the user provides feedback describing changes needed
    Then the LLM should regenerate the mapping incorporating the feedback
    And the revised mapping should be presented for review again

  Scenario: LLM maps source values to matching custom list entries
    Given the source data has a column with categorical values
    And the Spira template has a custom list whose values correspond to those categories
    When the LLM generates a mapping
    Then the mapping should include a lookup transform for that column
    And the lookup should map source values to the corresponding Spira list value IDs

  Scenario: LLM failure with retry on transient errors
    Given the LLM provider returns a transient error (rate limit or timeout)
    When the mapping is attempted
    Then the Importer should retry with exponential backoff
    And if all retries are exhausted it should report the error to the user
    And the user should be offered the option to retry or adjust the prompt

  Scenario: LLM provider credentials are invalid
    Given the LLM provider API key is invalid
    When the Importer attempts to generate a mapping
    Then it should return a descriptive error indicating authentication failure
    And the error should identify the provider that rejected the credentials
