import { createPortal } from 'react-dom'

// Page content sits in a z-[1] stacking context (Layout.tsx), so a fixed modal
// rendered in place stays under the fixed mobile nav. Render at the body.
export default function ModalPortal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body)
}
