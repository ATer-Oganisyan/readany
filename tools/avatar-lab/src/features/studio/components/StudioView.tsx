import { useEffect, useState } from 'react'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { StudioDialogs } from '@/features/studio/components/StudioDialogs'
import { StudioInspector } from '@/features/studio/components/StudioInspector'
import { StudioStage } from '@/features/studio/components/StudioStage'
import type { StudioController } from '@/features/studio/useStudioController'

const STACKED_LAYOUT_QUERY = '(max-width: 980px)'

export function StudioView(controller: StudioController) {
  const [stackedLayout, setStackedLayout] = useState(
    () => window.matchMedia(STACKED_LAYOUT_QUERY).matches
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia(STACKED_LAYOUT_QUERY)
    const updateStackedLayout = () => setStackedLayout(mediaQuery.matches)
    mediaQuery.addEventListener('change', updateStackedLayout)
    return () => mediaQuery.removeEventListener('change', updateStackedLayout)
  }, [])

  return (
    <div className="studio-root" lang={controller.language}>
      {stackedLayout ? (
        <ResizablePanelGroup
          className="studio studio-mobile-resizable"
          orientation="vertical"
          resizeTargetMinimumSize={{ coarse: 40, fine: 12 }}
        >
          <ResizablePanel
            id="preview"
            className="mobile-stage-panel"
            defaultSize="42%"
            minSize={180}
          >
            <StudioStage controller={controller} />
          </ResizablePanel>
          <ResizableHandle
            className="studio-resize-handle"
            withHandle
            aria-label={controller.t('Redimensionner l’aperçu et l’éditeur')}
          />
          <ResizablePanel id="editor" className="mobile-inspector-panel" minSize={260}>
            <StudioInspector controller={controller} />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="studio">
          <StudioStage controller={controller} />
          <StudioInspector controller={controller} />
        </div>
      )}
      <StudioDialogs controller={controller} />
    </div>
  )
}
