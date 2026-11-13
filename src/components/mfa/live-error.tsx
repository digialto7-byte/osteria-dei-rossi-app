/**
 * The error line of a second-factor form. The live region is always in the page and only its text changes, so a screen reader announces
 * the message every time it appears (section 3.13: "error text announced").
 */
export function LiveError({ message }: { message: string | null }) {
  return (
    <div aria-live="assertive" aria-atomic="true">
      {message && (
        <p className="rounded-lg border-l-4 border-danger bg-danger-bg px-4 py-3 leading-snug text-danger [overflow-wrap:anywhere]">
          {message}
        </p>
      )}
    </div>
  );
}
