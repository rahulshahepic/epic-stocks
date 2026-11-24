import { Link } from 'react-router-dom'
import ChatImportIntro from './ChatImportIntro.tsx'
import EpicFileImport from './EpicFileImport.tsx'
import { Card } from '../../scaffold/components/ui/Card.tsx'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'

/** An empty account: the ways in, easiest first. */
export default function GetStarted() {
  const config = useConfig()
  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-lg font-semibold text-cs-text">Get your stock in</h2>
        <p className="mt-1 text-sm text-cs-text-2">
          Pick whichever is easiest. You can mix them, and change anything later.
        </p>
      </div>
      <EpicFileImport />

      {config?.ai_connections && !config?.epic_mode && <ChatImportIntro />}
      <Card as="section" pad="md">
        <h3 className="text-sm font-medium text-cs-text">Enter it yourself</h3>
        <p className="mt-1 text-xs text-cs-text-2">
          Add each grant from your paperwork. Vesting dates start from Epic's usual
          schedule and you can change any of them.
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
          <Link to="/grants" className="text-cs-brand hover:underline">Add a grant</Link>
          <Link to="/import" className="text-cs-brand hover:underline">Restore from a workbook</Link>
        </div>
      </Card>
    </div>
  )
}
