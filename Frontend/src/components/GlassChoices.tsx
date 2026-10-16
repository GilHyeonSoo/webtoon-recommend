import { lazy, Suspense, useRef } from 'react'
import type { CSSProperties, PointerEvent } from 'react'

const GlassScene = lazy(() => import('./GlassScene').then((module) => ({ default: module.GlassScene })))

export function GlassChoices<T extends string>({ label, options, onSelect }: {
  label: string
  options: readonly { id: T; label: string }[]
  onSelect: (id: T) => void
}) {
  const stage = useRef<HTMLDivElement>(null)

  function movePointer(event: PointerEvent<HTMLButtonElement>) {
    const button = event.currentTarget
    const box = button.getBoundingClientRect()
    button.dataset.pointerX = String((event.clientX - box.left) / box.width * 2 - 1)
    button.dataset.pointerY = String(1 - (event.clientY - box.top) / box.height * 2)
  }

  function resetPointer(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.dataset.pointerX = '0'
    event.currentTarget.dataset.pointerY = '0'
  }

  return <div ref={stage} className="preference-options" role="group" aria-label={label}>
    <Suspense fallback={null}><GlassScene stageRef={stage} /></Suspense>
    {options.map((option, index) => <button
      key={option.id}
      type="button"
      className="preference-option orb-choice"
      style={{ '--order': index } as CSSProperties}
      onPointerMove={movePointer}
      onPointerLeave={resetPointer}
      onPointerCancel={resetPointer}
      onClick={() => onSelect(option.id)}
    >
      <span className="orb-surface" aria-hidden="true" />
      <span className="preference-option-label">{option.label}</span>
    </button>)}
  </div>
}
