import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import type * as React from 'react'

import { cn } from '@/lib/utils'

function Drawer(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />
}

function DrawerContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="drawer-backdrop" />
      <DialogPrimitive.Viewport className="drawer-viewport">
        <DialogPrimitive.Popup className={cn('drawer-content', className)} {...props}>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  )
}

function DrawerClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close {...props} />
}

function DrawerTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title className={cn('drawer-title', className)} {...props} />
}

function DrawerDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description className={cn('drawer-description', className)} {...props} />
}

export { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle }
