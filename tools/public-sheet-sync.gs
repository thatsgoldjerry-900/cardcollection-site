/**
 * Public sheet sync for IanBadeer.com
 *
 * Lives inside your PUBLIC Google Sheet (Extensions → Apps Script).
 * Every few hours it opens your private Excel master (the .xlsx synced to Google Drive),
 * copies ONLY the columns you list below into this sheet, and throws the temporary copy away.
 *
 * Your master is never shared. This script runs in your own Google account.
 * Keep edit access to this public sheet to yourself.
 *
 * Permissions are limited by tools/appsscript.json (paste it into the project's manifest):
 *   - read-only access to Drive (to read the master; it cannot change or delete anything)
 *   - create/delete only files this script makes (the temporary copy)
 *   - edit only this spreadsheet
 *   - run on a timer
 */

// ─────────────────────────── Settings: edit these ───────────────────────────

/** The ID of your Excel master: the long code between /d/ and /edit in its link. */
const MASTER_FILE_ID = 'PASTE_YOUR_MASTER_FILE_ID_HERE';

/**
 * What to copy. One entry per tab in this public sheet.
 *   from:      the tab name in your Excel master
 *   headerRow: the row your column titles are on (usually 1)
 *   columns:   the column TITLES to copy, exactly as written in the master.
 *              Only these columns are copied; everything else stays private.
 *   to:        the tab name to create or overwrite in this public sheet
 */
const IMPORTS = [
  {
    from: 'Main',
    headerRow: 1,
    columns: ['Player', 'Position', 'Pro Years', 'Status'],
    to: 'husker-nfl',
  },
  // Add more lists by copying the block above, e.g.:
  // { from: 'Stats', headerRow: 1, columns: ['Collection', 'Have', 'Total'], to: 'stats' },
];

/** How often to refresh, in hours (1, 2, 4, 6, 8 or 12). */
const REFRESH_EVERY_HOURS = 4;

// ─────────────────────────── No need to edit below ───────────────────────────

/** Copies the chosen columns from the master into this sheet. Run it by hand any time. */
function syncFromMaster() {
  const here = SpreadsheetApp.getActiveSpreadsheet();
  const tempId = convertMasterToTempSheet_();
  try {
    IMPORTS.forEach((job) => {
      let values;
      try {
        values = Sheets.Spreadsheets.Values.get(tempId, `'${job.from.replace(/'/g, "''")}'`, { valueRenderOption: 'FORMATTED_VALUE' }).values || [];
      } catch (e) {
        throw new Error(`The master has no tab named "${job.from}".`);
      }
      const headers = (values[job.headerRow - 1] || []).map((h) => String(h).trim());
      const picks = job.columns.map((name) => {
        const i = headers.indexOf(name);
        if (i < 0) throw new Error(`Tab "${job.from}" has no column titled "${name}". Its titles are: ${headers.filter(Boolean).join(', ')}`);
        return i;
      });
      const cell = (r, i) => (r[i] === undefined ? '' : r[i]);
      const rows = values.slice(job.headerRow)
        .filter((r) => picks.some((i) => String(cell(r, i)).trim() !== ''))  // skip blank rows
        .map((r) => picks.map((i) => cell(r, i)));
      const out = here.getSheetByName(job.to) || here.insertSheet(job.to);
      out.clearContents();
      out.getRange(1, 1, rows.length + 1, picks.length).setValues([job.columns, ...rows]);
    });
    stamp_(here, 'OK');
  } catch (err) {
    stamp_(here, 'FAILED: ' + err.message);
    throw err;
  } finally {
    Drive.Files.remove(tempId);  // delete the temporary converted copy right away
  }
}

/** Run this ONCE to turn on the automatic refresh. Running it again replaces the old timer. */
function turnOnAutoRefresh() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'syncFromMaster')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncFromMaster').timeBased().everyHours(REFRESH_EVERY_HOURS).create();
  syncFromMaster();
}

/** Makes a private, temporary Google Sheets copy of the .xlsx so it can be read. */
function convertMasterToTempSheet_() {
  if (MASTER_FILE_ID.startsWith('PASTE_')) throw new Error('Set MASTER_FILE_ID at the top of the script first.');
  const copy = Drive.Files.copy(
    { name: 'temp – public sheet sync (auto-deleted)', mimeType: MimeType.GOOGLE_SHEETS },
    MASTER_FILE_ID,
  );
  return copy.id;
}

/** Notes the last run on a private "sync-log" tab. Don't publish that tab. */
function stamp_(ss, status) {
  const log = ss.getSheetByName('sync-log') || ss.insertSheet('sync-log');
  log.getRange('A1:B1').setValues([['Last run', 'Result']]);
  log.getRange('A2:B2').setValues([[new Date(), status]]);
}
