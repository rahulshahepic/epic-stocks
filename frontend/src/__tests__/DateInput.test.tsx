import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DateInput } from '../scaffold/components/ui/DateInput.tsx'

function Form({ onCommit }: { onCommit: (value: string) => void }) {
  const [value, setValue] = useState('2032-02-29')
  return <label>
    Retirement date
    <DateInput value={value} max="2100-12-31" onChange={event => {
      setValue(event.target.value)
      onCommit(event.target.value)
    }} />
  </label>
}

describe('DateInput', () => {
  it('keeps the native input and reports out-of-range dates without changing native event behavior', () => {
    const onCommit = vi.fn()
    render(<Form onCommit={onCommit} />)
    const input = screen.getByLabelText('Retirement date')
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toHaveClass('cs-date-input')
    fireEvent.change(input, { target: { value: '2101-01-01' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a date on or before 2100-12-31.')
    expect(onCommit).toHaveBeenCalledWith('2101-01-01')
    fireEvent.change(input, { target: { value: '2033-01-01' } })
    expect(onCommit).toHaveBeenCalledWith('2033-01-01')
  })

  it('uses validated ISO text input when the browser cannot render dates', () => {
    const setType = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'type')!.set!
    const native = vi.spyOn(HTMLInputElement.prototype, 'type', 'set').mockImplementation(function (this: HTMLInputElement, type) {
      setType.call(this, type === 'date' ? 'text' : type)
    })
    try {
      const onCommit = vi.fn()
      render(<Form onCommit={onCommit} />)
      const input = screen.getByPlaceholderText('YYYY-MM-DD')
      expect(input).toHaveAttribute('type', 'text')
      fireEvent.change(input, { target: { value: '2033-02-29' } })
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid date in YYYY-MM-DD format.')
      expect((input as HTMLInputElement).validity.customError).toBe(true)
      expect(onCommit).not.toHaveBeenCalled()
      fireEvent.change(input, { target: { value: '2036-02-29' } })
      expect(onCommit).toHaveBeenCalledWith('2036-02-29')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      native.mockRestore()
    }
  })
})
