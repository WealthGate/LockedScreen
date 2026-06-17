import * as React from "react";

import { cn } from "../lib";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-sm transition placeholder:text-slate-900 focus-visible:border-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/25 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-200 dark:focus-visible:ring-offset-slate-950",
        className
      )}
      {...props}
    />
  );
});
