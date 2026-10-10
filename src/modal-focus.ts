const focusableSelector = 'a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)'

export function activateModalFocus(dialog: HTMLElement, onClose: () => void, ownerDocument: Document = document) {
  const previousFocus = ownerDocument.activeElement as HTMLElement | null
  const getFocusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.hidden && !element.closest('[inert], [aria-hidden="true"]') && element.getClientRects().length > 0)
  const focusInitialElement = () => {
    const focusableElements = getFocusableElements()
    const formField = focusableElements.find((element) => element.matches('input, select, textarea'))
    ;(formField ?? focusableElements[0] ?? dialog).focus()
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusableElements = getFocusableElements()
    const first = focusableElements[0]
    const last = focusableElements[focusableElements.length - 1]
    if (!first || !last) {
      event.preventDefault()
      dialog.focus()
    } else if (event.shiftKey && (ownerDocument.activeElement === first || !dialog.contains(ownerDocument.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (ownerDocument.activeElement === last || !dialog.contains(ownerDocument.activeElement))) {
      event.preventDefault()
      first.focus()
    }
  }
  const handleFocusIn = (event: FocusEvent) => {
    if (!dialog.contains(event.target as Node | null)) focusInitialElement()
  }

  focusInitialElement()
  ownerDocument.addEventListener('keydown', handleKeyDown)
  ownerDocument.addEventListener('focusin', handleFocusIn)
  return () => {
    ownerDocument.removeEventListener('keydown', handleKeyDown)
    ownerDocument.removeEventListener('focusin', handleFocusIn)
    if (previousFocus?.isConnected) {
      queueMicrotask(() => {
        if (previousFocus.isConnected) previousFocus.focus()
      })
    }
  }
}
