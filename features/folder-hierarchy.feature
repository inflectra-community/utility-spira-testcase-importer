Feature: Test Case Folder Hierarchy
  As a user
  I want to preserve or define folder structure for imported test cases
  So that they are organized within Spira

  Scenario: Create folder hierarchy from a mapped column
    Given the source data has a column mapped to folder path
    And the column contains hierarchical paths using a path separator
    When the import resolves folders
    Then all necessary parent and child folders should be created in Spira
    And each test case should be assigned to the folder matching its path

  Scenario: Reuse existing folders instead of creating duplicates
    Given the Spira project already has a folder matching a path in the source data
    When the import resolves folders
    Then it should reuse the existing folder
    And it should only create folders that do not already exist

  Scenario: No folder mapping places test cases at root
    Given the mapping does not include a folder path column
    When test cases are imported
    Then all test cases should be placed at the root level of the test case tree

  Scenario: Nested folder paths create intermediate folders
    Given the source data contains a deeply nested folder path
    When the import resolves folders
    Then all intermediate folders in the path should be created
    And the test case should be assigned to the deepest folder

  Scenario: Multiple test cases sharing a folder path reuse the same folder
    Given multiple source rows reference the same folder path
    When the import resolves folders
    Then only one folder should be created for that path
    And all matching test cases should be assigned to it
