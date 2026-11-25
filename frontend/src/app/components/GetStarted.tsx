import EquityTerms from './EquityTerms.tsx'
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
        <h1 className="text-lg font-semibold text-cs-text">Get your stock in</h1>
        <p className="mt-1 text-sm text-cs-text-2">
          Start with your Eureka files to bring in your grants and loans. You can review and change anything later.
        </p>
      </div>
      <EpicFileImport allowAssistant={!!config?.ai_connections && !config?.epic_mode} />

      <details className="space-y-4">
        <summary className="cursor-pointer py-2 text-sm font-semibold text-cs-text">Other ways to start</summary>
        {config?.ai_connections && !config?.epic_mode && <ChatImportIntro />}
        <Card as="section" pad="md">
          <h3 className="text-sm font-medium text-cs-text">Your first stock offer?</h3>
          <p className="mt-1 text-xs leading-relaxed text-cs-text-2">You can start with a single grant from your offer; you do not need a full history. Add the proposed shares, purchase price and any loan from the agreement, then review the assumptions before comparing compensation.</p>
          <Link to="/comp-calculator" className="mt-2 inline-block py-2 text-xs font-medium text-cs-brand hover:underline">Explore total compensation</Link>
        </Card>
        <EquityTerms terms={['vesting', 'grant', 'basis', 'loan', 'tax', 'price']} />
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
      </details>
    </div>
  )
}
