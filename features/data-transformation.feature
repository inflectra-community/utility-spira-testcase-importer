Feature: Data Transformation
  As a user importing test cases from Excel
  I want the mapped data to be correctly transformed into Spira format
  So that my test cases appear correctly in Spira

  Background:
    Given the Spira template has been retrieved with priorities, statuses, and types
    And the Spira template has a custom list "Automation Status" with active values

  Scenario: Direct field mapping transforms values unchanged
    Given a source spreadsheet with the following data:
      | Test Name       | Description          |
      | Login test      | Verify login works   |
      | Logout test     | Verify logout works  |
    And a mapping that maps "Test Name" directly to "Name"
    And a mapping that maps "Description" directly to "Description"
    When the data is transformed
    Then 2 test cases should be produced
    And test case 1 should have Name "Login test"
    And test case 1 should have Description "Verify login works"
    And test case 2 should have Name "Logout test"

  Scenario: Lookup mapping resolves source values to Spira list entry IDs
    Given a source spreadsheet with the following data:
      | Test Name   | Priority |
      | Login test  | High     |
      | Logout test | Low      |
    And the Spira template has priorities with names "High" and "Low"
    And a mapping that maps "Priority" via lookup to "TestCasePriorityId" using the template priority names
    When the data is transformed
    Then test case 1 should have TestCasePriorityId matching the "High" priority from the template
    And test case 2 should have TestCasePriorityId matching the "Low" priority from the template

  Scenario: Custom list lookup resolves to active list value IDs
    Given a source spreadsheet with the following data:
      | Test Name     | Automation    |
      | API test      | Automated     |
      | Manual test   | Not Automated |
    And a mapping that maps "Test Name" directly to "Name"
    And a mapping that maps "Automation" via lookup to the "Automation Status" custom list
    When the data is transformed
    Then test case 1 should have a custom property value matching "Automated" in the list
    And test case 2 should have a custom property value matching "Not Automated" in the list

  Scenario: Template mapping combines multiple source columns
    Given a source spreadsheet with the following data:
      | Module  | Feature    | Scenario          |
      | Auth    | Login      | Valid credentials  |
    And a mapping that maps "Module", "Feature", "Scenario" via template "{Module} > {Feature} > {Scenario}" to "Name"
    When the data is transformed
    Then test case 1 should have Name "Auth > Login > Valid credentials"

  Scenario: Missing Name field produces a validation error
    Given a source spreadsheet with the following data:
      | Description         |
      | Some description    |
    And a mapping that maps "Description" directly to "Description"
    And no source column is mapped to "Name"
    When the data is transformed and validated
    Then a validation error should be raised indicating the Name field is required

  Scenario: Test steps from separate rows with parent identifier
    Given a source spreadsheet with the following data:
      | TC_ID | TC_Name     | Step Description     | Expected Result       |
      | TC-1  | Login test  | Navigate to login    | Login page displayed  |
      | TC-1  | Login test  | Enter credentials    | Fields populated      |
      | TC-1  | Login test  | Click submit         | User logged in        |
      | TC-2  | Logout test | Click logout button  | User logged out       |
    And a mapping that identifies test case rows by "TC_ID"
    And test steps are mapped from "Step Description" and "Expected Result" columns
    When the data is transformed
    Then 2 test cases should be produced
    And the test case with identifier "TC-1" should have 3 test steps
    And the test case with identifier "TC-2" should have 1 test step
    And test step 1 of "TC-1" should have description "Navigate to login"
    And test step 1 of "TC-1" should have expected result "Login page displayed"
