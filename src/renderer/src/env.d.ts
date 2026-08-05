import type { CommitBubbleApi } from '../../shared/types'

declare global {
  interface Window {
    commitBubble: CommitBubbleApi
  }
}

export {}
