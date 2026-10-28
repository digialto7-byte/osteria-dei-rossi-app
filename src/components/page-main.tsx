import type { ReactNode } from "react";

/**
 * The one `main` of a page: the phone column (448 px, 1152 px for a `data-layout="wide"` page on a laptop)
 * with the reveal animation. The public layout and the app shell both render it, so every page has
 * exactly one.
 */
export function PageMain({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={
        "reveal mx-auto flex max-w-md flex-col gap-6 px-4 lg:has-[[data-layout=wide]]:max-w-6xl " +
        "pt-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] " +
        className
      }
    >
      {children}
    </main>
  );
}
