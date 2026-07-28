import { AlertBlock } from '@renderer/lib/ui'
import type { MarketplaceFeedback } from './useMarketplaceController'

export function MarketplaceFeedbackBanner({ feedback }: { feedback: MarketplaceFeedback | null }) {
  if (!feedback) return null
  if (feedback.kind === 'error') {
    return <AlertBlock className="text-xs">{feedback.text}</AlertBlock>
  }
  return (
    <p className="m-0 text-xs text-secondary [overflow-wrap:anywhere]" role="status">
      {feedback.text}
    </p>
  )
}
