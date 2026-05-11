import * as React from "react";

import { cn } from "../lib";

const variants = {
  primary: "bg-slate-950 text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200",
  secondary: "bg-white text-slate-950 ring-1 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-50 dark:ring-slate-600 dark:hover:bg-slate-800",
  ghost: "bg-transparent text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800",
  danger: "bg-rose-600 text-white hover:bg-rose-500"
} as const;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      className={cn(
        "inline-flex min-w-0 items-center justify-center gap-2 rounded-2xl border border-transparent px-3 py-2.5 text-sm font-semibold leading-5 transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-950 sm:px-4",
        variants[variant],
        className
      )}
      {...props}
    />
  );
});
