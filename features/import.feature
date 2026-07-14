Feature: Test Case Import via REST API
  As a user
  I want validated test cases injected into Spira via the REST API
  So that my data appears correctly in my project

  Background:
    Given the user has approved the validation report
    And validated test case data is ready for import

  Scenario: Successfully import test cases
    Given a batch of validated test cases
    When the import executes
    Then each test case should be created in the Spira project via the REST API
    And the import summary should show all succeeded with zero failures

  Scenario: Import test cases with test steps
    Given a validated test case that includes test steps
    When the import creates that test case
    Then the test case should be created first
    And then the test steps should be added to the created test case via the API

  Scenario: Import sets custom property values
    Given a validated test case has custom properties mapped from the source data
    When the import creates that test case
    Then the custom properties should be included in the creation request
    And each property should use the value type matching its definition in the template

  Scenario: Single test case failure does not stop the batch
    Given a batch of test cases where one will fail due to an API error
    When the import executes
    Then all other test cases should still be attempted
    And the failed test case should be logged with its source row reference
    And the summary should reflect the correct success and failure counts

  Scenario: Import summary report on completion
    Given the import has completed with some successes and some failures
    Then the summary should list the count of successful imports
    And the summary should list the count of failures
    And the summary should include the source row and error for each failure

  Scenario: Dry-run mode produces no API writes
    Given dry-run mode is enabled
    When the import executes
    Then zero mutating HTTP requests should be made to the Spira REST API
    And the output should indicate dry-run mode was active
    And the summary should report how many test cases would have been imported
