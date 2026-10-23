"use client";

import { use } from "react";
import { RecipeEditor } from "../../recipe-editor";

export default function NewVersionPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  return <RecipeEditor mode="version" recipeKey={key} />;
}
