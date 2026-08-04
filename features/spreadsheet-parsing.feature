Feature: Source Spreadsheet Parsing
  As a user
  I want to provide my test case data in Excel format
  So that the Importer can extract the raw data for LLM-assisted mapping

  Scenario: Parse a valid xlsx file
    Given an Excel file with defined column headers and data rows
    When I parse the spreadsheet
    Then the parser should extract all data rows
    And all column headers should be preserved
    And each row should be accessible by its column header

  Scenario: Parse a file with multiple worksheets
    Given an Excel file containing multiple worksheets
    When I parse the spreadsheet
    Then the Importer should present all worksheets for selection
    And the user should be able to select which worksheet contains test case data

  Scenario: Preserve data types during extraction
    Given an Excel file with columns containing strings, numbers, booleans, and dates
    When I parse the spreadsheet
    Then string values should remain as strings
    And numeric values should remain as numbers
    And boolean values should remain as booleans
    And date values should be preserved as dates

  Scenario: Handle unreadable file gracefully
    Given a file path pointing to a corrupted or invalid Excel file
    When I attempt to parse the spreadsheet
    Then I should receive a descriptive error indicating the file issue
    And the error should include the file path

  Scenario: Handle missing file gracefully
    Given a file path pointing to a non-existent file
    When I attempt to parse the spreadsheet
    Then I should receive a descriptive error indicating the file does not exist

  Scenario: Handle empty worksheet
    Given an Excel file with a worksheet containing only headers and no data rows
    When I parse the spreadsheet
    Then the parser should report zero data rows
    And the column headers should still be extracted
