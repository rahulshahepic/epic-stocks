/** Classify files only; the server still validates and bounds their contents. */
export function stockFiles(files: File[]) {
  let workbook: File | undefined, statement: File | undefined
  for (const file of files) {
    if (/\.(csv|xlsx)$/i.test(file.name)) {
      if (workbook) throw new Error('Choose one stock workbook at a time.')
      workbook = file
    } else if (/\.pdf$/i.test(file.name)) {
      if (statement) throw new Error('Choose one loan statement at a time.')
      statement = file
    } else throw new Error('Choose a CSV or XLSX stock workbook and an optional PDF loan statement.')
    if (file.size > 5 * 1024 * 1024) throw new Error('Each file must be 5 MB or smaller.')
  }
  return { workbook, statement }
}
