Feature: Data Transformation, Validation, and Approval
  As a user
  I want mapped data validated and presented for approval before import
  So that I can review the final results and give a go/no-go decision

  Background:
    Given a mapping has been confirmed by the user
    And source spreadsheet data is available

  Scenario: Transform all rows using confirmed mapping
    Given the confirmed mapping has field mappings defined
    And the source data has multiple rows
    When the Importer transforms the data
    Then it should produce one test case object per source row
    And each test case should have fields populated according to the mapping

  Scenario: Validate required fields are present
    Given a transformed test case is missing the Name field
    When the validation engine checks the data
    Then it should report an error for the row with the missing Name
    And the error should identify the field name and source row

  Scenario: Validate custom list values match template
    Given a transformed test case has a custom list value not present in the template
    When the validation engine checks the data
    Then it should report an error for the invalid list value
    And the error should specify which value was invalid and which list it belongs to

  Scenario: Generate validation report with summary
    Given transformation produces a set of test cases
    And validation finds errors and warnings
    When the validation report is generated
    Then the report total count should match the number of transformed test cases
    And the report should list each error with details
    And the report should list each warning
    And the report should include sample transformed records
    And the report should summarize the field mappings applied

  Scenario: User approves the validation report
    Given the validation report has been presented
    When the user explicitly approves the import
    Then the pipeline should proceed to the import phase

  Scenario: User rejects and returns to mapping
    Given the validation report has been presented
    When the user rejects the report
    Then the user should be returned to the mapping review step
    And they should be able to provide feedback to revise the mapping

  Scenario: No API writes occur before user approval
    Given the data has been transformed and validated
    But the user has NOT given approval
    Then zero mutating API requests should have been made to Spira
