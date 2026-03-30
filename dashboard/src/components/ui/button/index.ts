import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Button } from './Button.vue';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary/8 text-primary border border-primary/20 backdrop-blur-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.03)] hover:bg-primary/12 active:bg-primary/16',
        filled:
          'bg-[linear-gradient(180deg,var(--primary),color-mix(in_srgb,var(--primary)_90%,black))] text-primary-foreground shadow-[0_1px_4px_rgba(0,122,255,0.2)] hover:brightness-110 active:brightness-90',
        destructive:
          'bg-destructive/8 text-destructive border border-destructive/15 backdrop-blur-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.03)] hover:bg-destructive/12 active:bg-destructive/16',
        'destructive-filled':
          'bg-destructive text-white hover:brightness-110 active:brightness-90 shadow-[var(--shadow-sm)]',
        secondary:
          'bg-[var(--glass-bg)] text-text-primary border border-[var(--glass-border)] backdrop-blur-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.03)] hover:bg-[var(--glass-bg-heavy)] active:brightness-95',
        ghost: 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-text-primary',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-[30px] px-3.5',
        sm: 'h-[26px] px-2.5 text-[12px]',
        lg: 'h-[34px] px-4',
        icon: 'size-[30px]',
        'icon-sm': 'size-[26px]',
        'icon-lg': 'size-[34px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
