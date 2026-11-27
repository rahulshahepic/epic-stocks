/** Match native form validation in editors whose Save button calls a handler. */
export function reportDateErrors(editor: ParentNode | null) {
  const invalid = Array.from(editor?.querySelectorAll<HTMLInputElement>('.cs-date-input:invalid') ?? [])
    .find(input => !input.closest('[hidden]'))
  if (!invalid) return false
  invalid.reportValidity()
  return true
}
