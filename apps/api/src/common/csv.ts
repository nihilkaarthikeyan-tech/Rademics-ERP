/**
 * One CSV cell. Quotes when needed, and defuses spreadsheet formulas: a name
 * like `=HYPERLINK("http://evil","Click")` typed into the ERP would otherwise
 * run as a formula when Finance opens the export in Excel. Plain numbers
 * (including negatives) are left alone so they stay numbers.
 */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
