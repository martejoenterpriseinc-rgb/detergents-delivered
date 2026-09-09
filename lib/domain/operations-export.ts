export function csvText(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map(
          (v) =>
            '"' + (/^[=+\-@\t\r]/.test(v) ? "'" : "") + v.replaceAll('"', '""') + '"',
        )
        .join(","),
    )
    .join("\r\n");
}
export function exportCsv(name: string, rows: string[][]) {
  const url = URL.createObjectURL(
    new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
