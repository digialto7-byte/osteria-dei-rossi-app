import { t } from "@/lib/i18n";
import { tabLabel } from "@/lib/orders/order-view";
import { COURSES, type Course } from "@/server/orders/constants";

/**
 * The five courses as a tablist, in service order, each a 44 px button with its line count ("Primi · 2"). The selected
 * tab is where the next dish goes. The tabs wrap onto two rows at 360 px rather than scroll, so every course is in
 * reach of the thumb. The counts come from the server's lines.
 */
export function CourseTabs({
  selected,
  counts,
  onSelect,
}: {
  selected: Course;
  counts: Record<Course, number>;
  onSelect: (course: Course) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={t("orders.tabs.label")}
      className="sticky top-0 z-10 -mx-4 flex flex-wrap gap-2 border-b border-rule bg-paper px-4 py-2"
    >
      {COURSES.map((course) => {
        const on = course === selected;
        return (
          <button
            key={course}
            type="button"
            role="tab"
            id={`tab-${course}`}
            aria-selected={on}
            aria-controls={`panel-${course}`}
            onClick={() => onSelect(course)}
            className={
              "min-h-tap rounded-lg px-3 text-base font-bold transition-colors duration-150 " +
              (on
                ? "bg-accent text-on-accent"
                : "border border-rule-strong bg-surface text-ink hover:bg-sunk")
            }
          >
            {tabLabel(course, counts[course])}
          </button>
        );
      })}
    </div>
  );
}
