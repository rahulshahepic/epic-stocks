import { useEffect } from 'react'

type Resource = 'grants' | 'loans' | 'prices' | 'all'

let _channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!_channel) _channel = new BroadcastChannel('data_sync')
  return _channel
}

export function broadcastChange(resource: Resource) {
  getChannel()?.postMessage({ resource })
}

export function useDataSync(resource: Resource, onSync: () => void) {
  useEffect(() => {
    const ch = getChannel()
    if (!ch) return
    const handler = (e: MessageEvent) => {
      const r = e.data?.resource as Resource | undefined
      if (r === resource || r === 'all') onSync()
    }
    ch.addEventListener('message', handler)
    return () => ch.removeEventListener('message', handler)
  }, [resource, onSync])
}
