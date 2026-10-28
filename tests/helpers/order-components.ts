// Fixtures for the order components (M18 step 14). Fake data only.
import type { ServiceMenu, ServiceMenuItem } from "@/server/menu/output";
import { OIDS, STEW } from "./orders-data";

export const STEW_ITEM: ServiceMenuItem = {
  id: OIDS.item,
  name: STEW,
  category: "Secondi",
  course: "secondi",
  price: 14,
  available: true,
  unavailableReason: null,
  portionsLeft: 3,
  lowStock: true,
  pushed: false,
  pushPrice: null,
};

export const SOUP_ITEM: ServiceMenuItem = {
  id: OIDS.item2,
  name: "Zuppa del giorno (demo)",
  category: "Primi",
  course: "primi",
  price: 9,
  available: true,
  unavailableReason: null,
  portionsLeft: null,
  lowStock: false,
  pushed: false,
  pushPrice: null,
};

export const PASTA_ITEM: ServiceMenuItem = {
  id: "3e000000-0000-4000-8000-000000000004",
  name: "Tagliatelle al ragù (demo)",
  category: "Primi",
  course: "primi",
  price: 11,
  available: false,
  unavailableReason: "no_portions",
  portionsLeft: 0,
  lowStock: false,
  pushed: false,
  pushPrice: null,
};

export const DESSERT_ITEM: ServiceMenuItem = {
  id: OIDS.item3,
  name: "Tiramisù (demo)",
  category: "Dolci",
  course: "dolci",
  price: 6,
  available: true,
  unavailableReason: null,
  portionsLeft: null,
  lowStock: false,
  pushed: true,
  pushPrice: 4.5,
};

export const MENU: ServiceMenu = {
  pinned: [DESSERT_ITEM],
  categories: [
    { name: "Primi", items: [SOUP_ITEM, PASTA_ITEM] },
    { name: "Secondi", items: [STEW_ITEM] },
    { name: "Dolci", items: [DESSERT_ITEM] },
  ],
};
