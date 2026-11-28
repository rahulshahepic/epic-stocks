// Fit the full value to the tile's content width while preserving its default
// font size on roomier cards. Grouped numbers, including their sign and
// currency symbol, stay together.
export function StatFigure({ value, minLength = 0 }: { value: string; minLength?: number }) {
  const match = value.match(/^([+−-]?\$?\d[\d,.]*%?)( \(est\.\))?$/)
  if (!match) return value

  const [, figure, suffix] = match
  const length = Math.max(figure.length, minLength)
  const size = length > 15 ? 'text-[min(1em,9.5cqi)]'
    : length > 12 ? 'text-[min(1em,11.5cqi)]'
    : length > 10 ? 'text-[min(1em,13cqi)]'
    : 'text-[min(1em,15cqi)]'
  return <><span className={`whitespace-nowrap ${size}`}>{figure}</span>{suffix}</>
}
