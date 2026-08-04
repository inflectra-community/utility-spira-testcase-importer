Feature: Data Validation
  As a user importing test cases
  I want validation to catch errors before data reaches Spira
  So that I can fix problems and avoid corrupt data in my project

  Background:
    Given the Spira template has been retrieved with active priorities, statuses, types, and users
    And the template has a custom list with known active values

  Scenario: Valid test cases pass validation without errors
    Given transformed test cases with valid Names, valid status IDs, and valid priority IDs
    When the data is validated
    Then the validation result should have zero errors
    And all test cases should be reported as valid

  Scenario: Empty Name field produces a validation error
    Given a transformed test case with an empty Name field
    When the data is validated
    Then the validation result should report an error
    And the error should reference field "Name"
    And the error message should indicate the field is required

  Scenario: Priority ID not in template produces a validation error
    Given a transformed test case with a priority ID that does not exist in the template
    When the data is validated
    Then the validation result should report an error
    And the error should reference field "TestCasePriorityId"

  Scenario: Custom list value not in template produces a validation error
    Given a transformed test case with a custom property value not matching any active list entry
    When the data is validated
    Then the validation result should report an error
    And the error should reference the custom property field

  Scenario: Valid custom list value passes validation
    Given a transformed test case with a custom property value matching an active list entry
    When the data is validated
    Then the validation result should have zero errors for that property

  Scenario: Owner ID not in project users produces a warning
    Given a transformed test case with an owner ID not found in the project user list
    When the data is validated
    Then the validation result should include a finding for the "OwnerId" field
