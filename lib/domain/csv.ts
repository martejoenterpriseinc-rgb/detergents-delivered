import { AccountError } from "./account";
export function parseCsv(
  csv: string,
  limits = { bytes: 2_000_000, rows: 10_000, columns: 200, cell: 10_000 },
) {
  if (Buffer.byteLength(csv) > limits.bytes || csv.includes("\0"))
    throw new AccountError("Invalid or oversized CSV.", 422);
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const field = () => {
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > limits.columns)
      throw new AccountError("Invalid or oversized CSV.", 422);
  };
  const record = () => {
    field();
    if (row.some(Boolean)) rows.push(row);
    row = [];
    if (rows.length > limits.rows + 1)
      throw new AccountError("Invalid or oversized CSV.", 422);
  };
  csv = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === ",") field();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      record();
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new AccountError("Invalid or oversized CSV.", 422);
      cell += c;
    }
    if (cell.length > limits.cell)
      throw new AccountError("Invalid or oversized CSV.", 422);
  }
  if (quoted) throw new AccountError("Invalid or oversized CSV.", 422);
  if (cell || row.length || closed) record();
  return rows;
}
export function writeCsv(rows: (string | number)[][]) {
  return (
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value);
            if (/^[\s]*[=+@-]/.test(text)) text = "\'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}
