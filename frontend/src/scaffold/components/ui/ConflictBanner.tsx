/**
 * Shown when a save came back 409: the row changed somewhere else since it was
 * opened. The two ways out are to take the other version or to drop this one —
 * the wording has to name both, because nothing else on the screen does.
 */
export function ConflictBanner({ onReload, onDiscard }: {
  onReload: () => void
  onDiscard: () => void
}) {
  return (
    <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-700 dark:bg-yellow-900/20">
      <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300">
        This record was changed on another device. Reload to see the latest version, or discard your changes.
      </p>
      <div className="mt-2 flex gap-2">
        <button onClick={onReload} className="rounded-md bg-yellow-600 px-2 py-1 text-xs font-medium text-white hover:bg-yellow-700">
          Reload latest
        </button>
        <button onClick={onDiscard} className="rounded-md bg-gray-200 px-2 py-1 text-xs font-medium text-cs-text-2 hover:bg-gray-300 dark:hover:bg-gray-600">
          Discard my changes
        </button>
      </div>
    </div>
  )
}
