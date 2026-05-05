import { cn } from "@/lib/utils";

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex rounded px-2 py-1 text-xs font-semibold bg-gray-200 text-gray-800", className)}>
      {children}
    </span>
  );
}
