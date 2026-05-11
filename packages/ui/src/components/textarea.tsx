import * as React from "react";

import { cn } from "../lib";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "flex min-h-[120px] w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-sm transition placeholder:text-slate-900 focus-visible:border-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/25 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-200 dark:focus-visible:ring-offset-slate-950",
          className
        )}
        {...props}
      />
    );
  }
);
