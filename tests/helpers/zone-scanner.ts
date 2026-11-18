import ts from "typescript";

/** Zone-dependent functions and how many arguments make the zone present (SP1 step 11, plan §3.5). */
export const ZONE_ARGUMENT_COUNT: Record<string, number> = {
  venueDate: 2,
  venueYear: 2,
  formatDateTime: 3,
  formatTime: 3,
  formatWeekdayTime: 3,
  formatCsvInstant: 2,
  toCsv: 3,
};

export interface ZoneFinding {
  path: string;
  line: number;
  name: string;
}

const isUndefinedValue = (node: ts.Expression): boolean =>
  (ts.isIdentifier(node) && node.text === "undefined") ||
  (ts.isVoidExpression(node) && ts.isNumericLiteral(node.expression));

/** True when the zone argument is an explicit undefined: `undefined`, `void 0`, or `{ zone: undefined }`. */
function zoneIsUndefined(arg: ts.Expression): boolean {
  if (isUndefinedValue(arg)) return true;
  return (
    ts.isObjectLiteralExpression(arg) &&
    arg.properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        ts.isIdentifier(p.name) &&
        p.name.text === "zone" &&
        isUndefinedValue(p.initializer),
    )
  );
}

/**
 * Calls of a zone-dependent function without its zone argument (or with an explicit undefined), uses of one as a bare value, calls
 * through a namespace member, and renamed imports (which would hide the call from the scan). Parsed, so comments and strings never match.
 */
export function callsWithoutZone(path: string, text: string): ZoneFinding[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: ZoneFinding[] = [];
  const at = (node: ts.Node, name: string) =>
    found.push({
      path,
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      name,
    });
  const listed = (name: string) => Object.hasOwn(ZONE_ARGUMENT_COUNT, name);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          if (el.propertyName && listed(el.propertyName.text)) at(el, el.propertyName.text);
        }
      }
      return;
    }
    if (ts.isExportDeclaration(node)) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      if (name !== null && listed(name)) {
        const needed = ZONE_ARGUMENT_COUNT[name]!;
        const zoneArg = node.arguments[needed - 1];
        if (zoneArg === undefined || zoneIsUndefined(zoneArg)) at(node, name);
        node.arguments.forEach(visit);
        if (ts.isPropertyAccessExpression(callee)) visit(callee.expression);
        return;
      }
    }
    if (ts.isIdentifier(node) && listed(node.text)) {
      const parent = node.parent;
      const isDeclaration =
        (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) &&
        parent.name === node;
      if (!isDeclaration) at(node, node.text); // not a direct call: passed as a value
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
