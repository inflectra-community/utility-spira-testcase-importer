Feature: Spira Connection and Authentication
  As a user
  I want to connect to my Spira instance securely
  So that the Importer can retrieve template data and inject test cases

  Background:
    Given a Spira instance is available at the configured base URL

  Scenario: Successful authentication with valid credentials
    Given I have a valid Spira username and API key
    When I authenticate against the Spira REST API
    Then the connection should be confirmed as valid
    And no credentials should be persisted to disk

  Scenario: Authentication fails with invalid API key
    Given I have a valid Spira username
    And I have an invalid API key
    When I authenticate against the Spira REST API
    Then I should receive a descriptive error indicating authentication failure
    And the error message should mention the cause of failure

  Scenario: Authentication fails with unreachable server
    Given the Spira base URL points to an unreachable server
    When I attempt to authenticate
    Then I should receive a descriptive error indicating a connection failure

  Scenario: Credentials are protected from accidental exposure
    Given I have provided credentials via a .env file
    When the import session completes
    Then the .env file pattern should be listed in .gitignore
    And no credentials should appear in the log output
