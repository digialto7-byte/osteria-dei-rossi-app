"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorAlert, Heading, Muted, SubHeading, SuccessNote } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import {
  bodyFromForm,
  emptyMenuForm,
  formFromItem,
  patchFromForm,
  type MenuFormErrors,
  type MenuFormState,
} from "@/lib/menu/menu-form";
import { groupByCategory } from "@/lib/menu/menu-view";
import type { ManageMenu } from "@/server/menu/output";
import { MenuItemCard } from "./menu-item-card";
import { MenuItemForm, type RecipeChoice } from "./menu-item-form";

const FORBIDDEN = 403;

type Editing = { kind: "create" } | { kind: "edit"; id: string };

/**
 * The menu as the owner and admin manage it. Reads /api/menu/items (and the active plates from /api/recipes) and
 * writes /api/menu/items and /api/menu/:id; the price strings, the badges and every error text are the server's or
 * the view helpers'. The waiter and the chef get one notice.
 */
export default function MenuPage() {
  const [menu, setMenu] = useState<ManageMenu | null>(null);
  const [recipes, setRecipes] = useState<RecipeChoice[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<MenuFormErrors>({});
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const result = await apiJson<ManageMenu>("/api/menu/items");
    if (!result.ok) {
      if (result.status === FORBIDDEN) setForbidden(true);
      else setMessage(result.error.message);
      return false;
    }
    setMessage(null);
    setMenu(result.data);
    return true;
  }, []);

  useEffect(() => {
    // Loading the menu and the plates when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void apiJson<{ recipes: RecipeChoice[] }>("/api/recipes?type=plate&active=true").then(
      (result) => {
        if (result.ok) setRecipes(result.data.recipes);
      },
    );
  }, [load]);

  function close() {
    setEditing(null);
    setFormError(null);
    setFieldErrors({});
  }

  function open(next: Editing) {
    setSaved(false);
    setFormError(null);
    setFieldErrors({});
    setEditing(next);
  }

  async function submit(state: MenuFormState) {
    if (!menu || !editing) return;
    setFormError(null);
    let request: { path: string; method: "POST" | "PATCH"; body: object } | null;
    if (editing.kind === "create") {
      const built = bodyFromForm(state);
      if (!built.ok) return setFieldErrors(built.errors);
      request = { path: "/api/menu/items", method: "POST", body: built.body };
    } else {
      const item = menu.items.find((candidate) => candidate.id === editing.id);
      if (!item) return close();
      const built = patchFromForm(state, item);
      if (!built.ok) return setFieldErrors(built.errors);
      request =
        Object.keys(built.patch).length === 0
          ? null
          : { path: `/api/menu/${item.id}`, method: "PATCH", body: built.patch };
    }
    setFieldErrors({});
    if (request === null) return close();
    setBusy(true);
    const result = await apiJson(request.path, { method: request.method, body: request.body });
    if (!result.ok) {
      setFormError(result.error.message);
    } else if (await load()) {
      close();
      setSaved(true);
    }
    setBusy(false);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("menu.title")}</Heading>
        <ErrorAlert message={t("menu.forbidden")} />
      </>
    );
  }

  const editedItem =
    editing?.kind === "edit" ? menu?.items.find((item) => item.id === editing.id) : undefined;

  return (
    <>
      <Heading>{t("menu.title")}</Heading>
      <Muted>{t("menu.hint")}</Muted>
      <ErrorAlert message={message} />
      {saved && <SuccessNote role="status">{t("menu.saved")}</SuccessNote>}
      {menu === null ? (
        !message && <Muted>{t("common.loading")}</Muted>
      ) : (
        <>
          {editing === null && (
            <Button onClick={() => open({ kind: "create" })} className="self-start">
              {t("menu.new")}
            </Button>
          )}
          {editing !== null && (
            <MenuItemForm
              key={editing.kind === "edit" ? editing.id : "new"}
              mode={editing.kind}
              initial={editedItem ? formFromItem(editedItem) : emptyMenuForm(menu.defaults.vatRate)}
              recipes={recipes}
              currentRecipe={
                editedItem?.recipeKey && editedItem.recipeName
                  ? { key: editedItem.recipeKey, name: editedItem.recipeName }
                  : null
              }
              vatRates={menu.vatRates}
              courses={menu.courses}
              categories={menu.categories}
              busy={busy}
              error={formError}
              errors={fieldErrors}
              onSubmit={(state) => void submit(state)}
              onCancel={close}
            />
          )}
          {menu.items.length === 0 ? (
            <Muted>{t("menu.empty")}</Muted>
          ) : (
            groupByCategory(menu.items).map((group) => (
              <section key={group.name} className="flex flex-col gap-3">
                <SubHeading>{group.name}</SubHeading>
                {group.items.map((item) => (
                  <MenuItemCard
                    key={item.id}
                    item={item}
                    onEdit={() => open({ kind: "edit", id: item.id })}
                  />
                ))}
              </section>
            ))
          )}
        </>
      )}
    </>
  );
}
