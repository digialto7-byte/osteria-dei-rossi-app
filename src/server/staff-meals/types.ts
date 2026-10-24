export type StaffMealKind = "recipe" | "ingredient";

/** One rule of public.staff_meal_rules(). */
export interface StaffMealRuleItem {
  ruleId: string;
  kind: StaffMealKind;
  targetId: string;
  name: string;
  /** "porzioni" for a recipe, else the ingredient's base unit. */
  unit: string;
  defaultCount: number;
  locationId: string | null;
  isActive: boolean;
  /** Portions in unexpired fresh or open batches; null for an ingredient. */
  available: number | null;
  today: { confirmationId: string; count: number; at: string; byInitials: string } | null;
}

export interface StaffMealRules {
  businessDate: string;
  rules: StaffMealRuleItem[];
}

/** The answer of public.set_staff_meal_rule; `created` only picks 201 or 200 and is not sent on. */
export interface StaffMealRuleResult {
  ruleId: string;
  created: boolean;
  kind: StaffMealKind;
  targetId: string;
  defaultCount: number;
  locationId: string | null;
  isActive: boolean;
}

/** The answer of public.confirm_staff_meal. */
export interface StaffMealConfirmation {
  confirmationId: string;
  ruleId: string;
  businessDate: string;
  count: number;
  movements: Array<{ batchId: string; portions: number } | { ingredientId: string; qty: number }>;
  negatives: Array<{ ingredientId: string; locationId: string; onHandQty: number }>;
}
