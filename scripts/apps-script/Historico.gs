function onOpen(e) {
  const menu = [
    { name: "Run", functionName: "run" },
    { name: "Format", functionName: "format" }
  ]
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  ss.addMenu("Scripts", menu)
}
