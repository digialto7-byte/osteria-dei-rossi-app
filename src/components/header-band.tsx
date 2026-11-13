import type { ReactNode } from "react";

/**
 * The green header band, one per page. It used to sit in the root layout; the `(public)` layout, the signed-in shell and the 404 page
 * now each render it with their own `brand` (a link to Home or, for a guest, plain text). `account` is a slot for the signed-in
 * user's own control and stays empty until it is built.
 */
export function HeaderBand({ brand, account }: { brand: ReactNode; account?: ReactNode }) {
  return (
    <header className="band border-b-2 border-gold">
      <div className="mx-auto flex max-w-md items-center gap-2.5 px-4 lg:group-has-[[data-layout=wide]]/body:max-w-6xl pt-[max(0.875rem,env(safe-area-inset-top))] pb-3.5">
        {brand}
        {account}
      </div>
    </header>
  );
}
