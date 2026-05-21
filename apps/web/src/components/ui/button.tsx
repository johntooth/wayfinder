import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] text-[13px] font-medium tracking-[-0.1px] ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "border border-[#3a5fd9] bg-[#3a5fd9] text-white hover:opacity-90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        danger:
          "border border-[#f3ccd6] bg-[#fdeef2] text-[#c2385a] hover:bg-[#fde8ef]",
        outline:
          "border border-[#dedad2] bg-white text-[#1a1814] hover:bg-[#efede8]",
        secondary:
          "border border-[#dedad2] bg-white text-[#1a1814] hover:bg-[#efede8]",
        ghost:
          "border border-[#dedad2] bg-transparent text-[#1a1814] hover:bg-[#efede8]",
        link: "text-[#3a5fd9] underline-offset-4 hover:underline",
      },
      size: {
        default: "px-4 py-2",
        sm: "px-[11px] py-[5px] text-xs",
        lg: "px-8 py-[10px]",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
