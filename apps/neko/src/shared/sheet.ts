/** Link that opens the sheet with one cell selected (used by the web and the reminders). */
export const sheetCellUrl = (sheetId: string, gid: number | undefined, a1: string) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${gid ?? 0}&range=${a1}`;
