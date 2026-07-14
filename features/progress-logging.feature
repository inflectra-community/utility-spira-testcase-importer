Feature: Import Progress and Logging
  As a user
  I want to see progress and detailed logs during import
  So that I can monitor the operation and troubleshoot issues

  Scenario: Display progress during import
    Given an import is in progress with a batch of test cases
    Then the Importer should display the current item count relative to total
    And progress should update as each test case is processed

  Scenario: Log all API requests and responses
    Given an import session is running
    When API requests are made to Spira
    Then the logger should record the HTTP method, URL, response status, and duration for each

  Scenario: Persist log file on completion
    Given an import session completes (success or failure)
    Then the full log should be written to a file in the working directory
    And the log file should contain all API request/response records

  Scenario: Log state on interruption
    Given an import is partway through processing a batch
    When the process receives an interrupt signal
    Then the log should record which test cases were successfully imported
    And the log should record which test cases remain unprocessed
    And the log file should be persisted before exit
