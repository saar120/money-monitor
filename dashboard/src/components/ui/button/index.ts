import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Button } from './Button.vue';

export const buttonVariants = cva(
  'ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary/8 text-primary border border-primary/20 hover:bg-primary/12 active:bg-primary/16',
        filled: 'bg-primary text-primary-foreground hover:brightness-110 active:brightness-90',
        destructive:
          'bg-destructive/8 text-destructive border border-destructive/15 hover:bg-destructive/12 active:bg-destructive/16',
        'destructive-filled':
          'bg-destructive text-white hover:brightness-110 active:brightness-90 shadow-[var(--shadow-sm)]',
        secondary:
          'bg-bg-primary text-text-primary border border-separator hover:bg-bg-secondary active:brightness-95',
        ghost: 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-text-primary',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3',
        sm: 'h-9 px-3',
        lg: 'h-9 px-4',
        icon: 'size-9',
        'icon-sm': 'size-9',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
