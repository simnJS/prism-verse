export function snake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

export function pascal(name: string): string {
  return name
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

export function singular(name: string): string {
  if (/ies$/.test(name) && name.length > 3) return name.slice(0, -3) + "y";
  if (/[^s]s$/.test(name)) return name.slice(0, -1);
  return name;
}

// Language keywords and macros: never usable as a name.
const RESERVED = new Set([
  "_", "and", "array", "at", "block", "branch", "break", "case", "class", "continue", "defer", "do", "else", "enum",
  "external", "false", "first", "for", "if", "import", "interface", "is", "live", "loop", "map", "module", "none",
  "not", "of", "option", "or", "profile", "race", "ref", "return", "rush", "scoped", "set", "spawn", "struct",
  "sync", "then", "to", "true", "type", "upon", "using", "var", "when", "where", "yield",
]);

// Always in scope in generated code: /Verse.org/Verse (implicit), /Verse.org/Simulation, /Verse.org/Concurrency
// (from the UEFN digest) and the language intrinsics. A field or class with one of these names is ambiguous.
const BUILTINS = new Set([
  "Abs", "ArCosh", "ArSinh", "ArTanh", "ArcCos", "ArcSin", "ArcTan", "Ceil", "Clamp", "Concatenate",
  "ConcatenateMaps", "Cos", "Cosh", "Err", "Exp", "FitsInPlayerMap", "Floor", "GetRandomFloat", "GetRandomInt",
  "GetSecondsSinceEpoch", "GetSession", "GetSimulationElapsedTime", "Inf", "Int", "IsAlmostEqual", "Join", "Lerp",
  "Ln", "Localize", "Log", "MakeClassifiableSubset", "MakeError", "MakeLocalizableValue", "MakeMessageInternal",
  "MakeMessageLiteral", "MakeSuccess", "Max", "Min", "Mod", "NaN", "PiFloat", "Pow", "Print", "Quotient", "Round",
  "Self", "Sgn", "Shuffle", "Sin", "Sinh", "Sleep", "Sqrt", "Tan", "Tanh", "ToDiagnostic", "ToString", "agent",
  "any", "awaitable", "cancelable", "castable_subtype", "char", "char32", "classifiable_subset", "comparable",
  "concrete_subtype", "diagnostic", "disposable", "editable", "editable_container", "editable_number",
  "editable_slider", "editable_text_box", "editable_vector_number", "editable_vector_slider", "enableable", "event",
  "float", "generator", "int", "invalidatable", "listenable", "locale", "localizable_float", "localizable_int",
  "localizable_message", "localizable_string", "localizable_value", "logic", "message", "modifier", "modifier_stack",
  "player", "rational", "result", "session", "session_environment", "showable", "signalable", "sticky_event",
  "string", "subscribable", "subscribable_event", "subtype", "super", "task", "team", "tuple", "void", "weak_map",
]);

export function isReserved(name: string): boolean {
  return RESERVED.has(name);
}

export function isBuiltin(name: string): boolean {
  return BUILTINS.has(name);
}

export function isIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function closest(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = distance(name.toLowerCase(), c.toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  return best !== undefined && bestScore <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

// Picks a local name that doesn't clash with any member of the generated class.
export function fresh(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 1; ; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
