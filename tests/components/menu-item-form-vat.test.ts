// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MenuItemForm } from "@/app/(owner)/menu/menu-item-form";
import { formFromItem } from "@/lib/menu/menu-form";
import { IDS, MANAGE_MENU, MAPPED_ITEM } from "../helpers/menu-tables-data";

afterEach(cleanup);

// SP1 step 10 (Q12 note): an item stored at 4 % while the tenant's list is [10, 22] keeps 4 % as an option for as long as the form is open,
// also after another rate is picked: the option is the STORED rate, not the form's current value.
const OLD_FOUR = { ...MAPPED_ITEM, vatRate: 4 };
const show = () =>
  render(
    createElement(MenuItemForm, {
      mode: "edit",
      initial: formFromItem(OLD_FOUR),
      recipes: [{ key: IDS.recipeKey, name: "Spezzatino con polenta (demo)" }],
      vatRates: [10, 22],
      storedVatRate: OLD_FOUR.vatRate,
      courses: MANAGE_MENU.courses,
      categories: MANAGE_MENU.categories,
      busy: false,
      error: null,
      errors: {},
      onSubmit: () => undefined,
      onCancel: () => undefined,
    }),
  );
const select = () => document.querySelector('select[name="vatRate"]') as HTMLSelectElement;
const values = () => [...select().options].map((o) => o.value);

describe("MenuItemForm, the stored VAT rate", () => {
  it("shows the stored 4 % as the current option next to the tenant's list", () => {
    show();
    expect(values()).toEqual(["4", "10", "22"]);
    expect(select().value).toBe("4");
  });

  it("picking another rate does not make the stored out-of-list rate disappear", () => {
    show();
    fireEvent.change(select(), { target: { value: "10" } });
    expect(select().value).toBe("10");
    expect(values()).toEqual(["4", "10", "22"]);
    fireEvent.change(select(), { target: { value: "4" } });
    expect(select().value).toBe("4");
  });
});
