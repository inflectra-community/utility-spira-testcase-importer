import { describe, it, expect } from 'vitest';
import { detectStructure } from './structure-detector.js';

describe('detectStructure — folder detection', () => {
  it('detects a folder column by path separators', () => {
    const rows = [
      { Name: 'TC1', Folder: 'SD/O2C/Orders' },
      { Name: 'TC2', Folder: 'SD/O2C/Delivery' },
      { Name: 'TC3', Folder: 'FI/A2R' },
      { Name: 'TC4', Folder: 'FI/A2R/Assets' },
    ];
    const { folderStructure } = detectStructure(['Name', 'Folder'], rows);
    expect(folderStructure.detected).toBe(true);
    expect(folderStructure.column).toBe('Folder');
    expect(folderStructure.separator).toBe('/');
  });

  it('does not flag a plain text column as a folder', () => {
    const rows = [
      { Name: 'TC1', Desc: 'Verify login works correctly' },
      { Name: 'TC2', Desc: 'Verify logout clears session' },
      { Name: 'TC3', Desc: 'Check password reset flow' },
    ];
    const { folderStructure } = detectStructure(['Name', 'Desc'], rows);
    expect(folderStructure.detected).toBe(false);
  });
});

describe('detectStructure — inline steps', () => {
  it('detects numbered-dot inline steps', () => {
    const steps = [
      '1. Open the app\n2. Log in\n3. Navigate to dashboard\n4. Verify widgets load',
      '1. Create an order\n2. Add line items\n3. Submit\n4. Confirm the total',
      '1. Open settings\n2. Change the theme\n3. Save\n4. Reload and verify',
    ];
    const rows = steps.map((s, i) => ({ Name: `TC${i}`, Steps: s }));
    const { stepStructure } = detectStructure(['Name', 'Steps'], rows);
    expect(stepStructure.mode).toBe('inline');
    expect(stepStructure.inlineColumn).toBe('Steps');
    expect(stepStructure.inlineDelimiter).toBe('numbered-dot');
  });

  it('returns mode none when no step structure is present', () => {
    const rows = [
      { Name: 'TC1', Priority: 'High' },
      { Name: 'TC2', Priority: 'Low' },
      { Name: 'TC3', Priority: 'Medium' },
    ];
    const { stepStructure } = detectStructure(['Name', 'Priority'], rows);
    expect(stepStructure.mode).toBe('none');
  });
});

describe('detectStructure — separate rows', () => {
  it('detects grouped rows with a step-number column and grouping id', () => {
    // Needs 3+ distinct groups: the detector skips grouping columns with <= 2
    // unique values (treats them as constants).
    const rows = [
      { TC_ID: 'TC-1', Step: 1, 'Step Description': 'Navigate to login', 'Expected Result': 'Login shown' },
      { TC_ID: 'TC-1', Step: 2, 'Step Description': 'Enter credentials', 'Expected Result': 'Fields filled' },
      { TC_ID: 'TC-1', Step: 3, 'Step Description': 'Click submit', 'Expected Result': 'Logged in' },
      { TC_ID: 'TC-2', Step: 1, 'Step Description': 'Click logout', 'Expected Result': 'Logged out' },
      { TC_ID: 'TC-2', Step: 2, 'Step Description': 'Confirm', 'Expected Result': 'Back to login' },
      { TC_ID: 'TC-3', Step: 1, 'Step Description': 'Open report', 'Expected Result': 'Report opens' },
      { TC_ID: 'TC-3', Step: 2, 'Step Description': 'Export CSV', 'Expected Result': 'File downloads' },
      { TC_ID: 'TC-4', Step: 1, 'Step Description': 'Delete record', 'Expected Result': 'Record gone' },
    ];
    const { stepStructure } = detectStructure(['TC_ID', 'Step', 'Step Description', 'Expected Result'], rows);
    expect(stepStructure.mode).toBe('separate-rows');
    expect(stepStructure.stepNumberColumn).toBe('Step');
    expect(stepStructure.groupingColumn).toBe('TC_ID');
    expect(stepStructure.stepDescriptionColumn).toBe('Step Description');
    expect(stepStructure.stepExpectedResultColumn).toBe('Expected Result');
  });
});
