'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

type SwitchProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

function Switch({
  className,
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  onClick,
  ...props
}: SwitchProps) {
  const isControlled = typeof checked === 'boolean'
  const [internalChecked, setInternalChecked] = React.useState(defaultChecked)
  const currentChecked = isControlled ? Boolean(checked) : internalChecked

  React.useEffect(() => {
    if (isControlled && checked !== internalChecked) {
      setInternalChecked(Boolean(checked))
    }
  }, [checked, internalChecked, isControlled])

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || disabled) return
    const next = !currentChecked
    if (!isControlled) {
      setInternalChecked(next)
    }
    onCheckedChange?.(next)
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={currentChecked}
      data-slot="switch"
      disabled={disabled}
      data-state={currentChecked ? 'checked' : 'unchecked'}
      className={cn(
        'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      onClick={handleClick}
      {...props}
    >
      <span
        data-slot="switch-thumb"
        data-state={currentChecked ? 'checked' : 'unchecked'}
        className={
          'bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0'
        }
      />
    </button>
  )
}

export { Switch }
