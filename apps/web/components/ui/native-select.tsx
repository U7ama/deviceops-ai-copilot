import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Preserve native keyboard, form, and change-event behavior for operational controls.
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <span className="native-select" data-disabled={props.disabled || undefined}>
    <select {...props} className={cn('native-select-input', className)} />
    <ChevronDown className="native-select-chevron" size={16} aria-hidden="true" />
  </span>;
}
