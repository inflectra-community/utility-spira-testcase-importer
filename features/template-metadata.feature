Feature: Template Metadata Retrieval
  As a user
  I want the Importer to retrieve my project's template configuration
  So that the LLM has the complete schema to map data against

  Background:
    Given I am authenticated against a Spira instance
    And a target project is specified

  Scenario: Retrieve all test case custom properties
    When the Importer fetches template metadata
    Then it should retrieve all custom property definitions for test cases
    And each custom property should include its name, type, and property number

  Scenario: Retrieve custom list values for list-type properties
    Given the project template has custom properties of type "list"
    When the Importer fetches template metadata
    Then it should retrieve all active custom list values for each list-type property
    And each list value should include its ID and name

  Scenario: Retrieve standard field metadata
    When the Importer fetches template metadata
    Then it should retrieve the active test case priorities
    And it should retrieve the active test case statuses
    And it should retrieve the active test case types
    And it should retrieve the project components

  Scenario: Retrieve project users for assignment
    When the Importer fetches template metadata
    Then it should retrieve the list of active users available for assignment
    And each user should include their ID and full name

  Scenario: Partial metadata failure is non-fatal
    Given one of the metadata endpoints returns a server error
    When the Importer fetches template metadata
    Then it should report which specific metadata could not be retrieved
    And it should still successfully retrieve all other metadata categories
