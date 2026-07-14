Feature: Import Execution
  As a user who has approved the validation report
  I want test cases injected into Spira reliably
  So that my data appears correctly in my project without data loss

  Background:
    Given the Spira template has been retrieved
    And the import engine is configured with a mock Spira API

  Scenario: Successful import creates all test cases
    Given a batch of valid transformed test cases
    When the import is executed
    Then all test cases should be created successfully
    And the import result should show zero failures

  Scenario: Individual test case failure does not stop remaining imports
    Given a batch of transformed test cases where one will fail due to an API error
    When the import is executed
    Then all other test cases should still be attempted
    And the failure should be logged with its source row reference
    And the import result should reflect the correct success and failure counts

  Scenario: Import result accounting is always consistent
    Given a batch of transformed test cases where some will fail
    When the import is executed
    Then success count plus failure count should equal total attempted
    And each failure should contain a source row index and error message

  Scenario: Test steps are created for test cases that include them
    Given a transformed test case with associated test steps
    When the import is executed
    Then the test case should be created first
    And then test steps should be added to the created test case via the API

  Scenario: Folder hierarchy is resolved before test case creation
    Given transformed test cases with varying folder paths
    When the import is executed
    Then folders should be resolved or created before test cases are inserted
    And each test case should be assigned the folder ID matching its path
    And test cases with no folder path should be assigned to root
