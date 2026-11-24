/** Shared instructions for the anonymous preview and signed-in import. */
export default function EurekaFileGuide() {
  return (
    <div className="space-y-2 text-xs leading-relaxed text-cs-text-2">
      <p>Start with <strong>Data for Stock Workbook</strong> from Eureka (.csv or .xlsx).
        Add your latest <strong>Stock Loan Statement</strong> (.pdf) if you have loans.
        Upload the original downloads without editing them.</p>
      <details>
        <summary className="cursor-pointer py-2 font-medium text-cs-brand">Which files do I need?</summary>
        <ul className="list-disc space-y-2 pl-5">
          <li>The stock workbook supplies grant and share details. A statement alone gives a partial preview.</li>
          <li>No loans? You can skip the statement. If you do have loans, add it before relying on a net figure; a missing file does not mean no debt.</li>
          <li>Use the latest statement. The stock workbook can lag a payoff or refinance; review any differences before saving.</li>
          <li>A purchase agreement, screenshot or scanned document needs a different route: use your AI assistant from a signed-in account, or enter the details yourself.</li>
        </ul>
      </details>
    </div>
  )
}
