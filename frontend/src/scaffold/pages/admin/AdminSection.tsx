import type { ReactNode } from 'react'
import { Card } from '../../components/ui/Card.tsx'

/**
 * The card every admin panel sits in. Written out eleven times before this,
 * which is why one of them had drifted to a different heading weight.
 */
export function AdminSection({ title, action, children }: {
  title: ReactNode
  /** Controls that belong beside the heading rather than in the body. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card as="section" pad="md">
      {action ? (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-cs-text">{title}</h3>
          {action}
        </div>
      ) : (
        <h3 className="text-sm font-medium text-cs-text">{title}</h3>
      )}
      {children}
    </Card>
  )
}
