Feature: Approval Workflow
  As a user importing test cases
  I want to review and approve the mapped data before it reaches Spira
  So that I have full control over what gets imported

  Scenario: No API writes occur before user approval
    Given a complete mapping and transformed data
    And the user has NOT approved the import
    Then no mutating API calls should have been made to Spira

  Scenario: Validation report shows correct statistics
    Given a set of transformed test cases with some validation errors and warnings
    When the validation report is generated
    Then the report total count should match the number of transformed test cases
    And the report error count should match the number of validation errors
    And the report warning count should match the number of validation warnings
    And the report should include at least one sample record

  Scenario: Validation report includes field mapping summary
    Given a confirmed mapping with multiple field mappings
    And a set of transformed test cases with no validation errors
    When the validation report is generated
    Then the report should include a field mapping summary
    And the field mapping summary should reference all confirmed mappings
