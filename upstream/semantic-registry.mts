/**
 * @file sections/b8g-ghost/semantic-registry.mts
 * @description Dual-Layer Semantic Canonical AST Hasher & Flat GhostModuleRegistry Generator.
 * Strips comments/whitespace, applies De Bruijn alpha-canonicalization ($0, $1, ...) to
 * function parameters/locals, and emits orthogonal `abi_hash` + `impl_hash` entries into
 * a flat deterministic `ghost-semantic-registry.json`.
 *
 * Strictly zero external dependencies, `erasableSyntaxOnly: true`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

export interface SemanticSymbolEntry {
  readonly name: string;
  readonly kind: 'function' | 'declaration';
  readonly canonicalSignature: string;
  readonly abi_hash: string;
  readonly impl_hash: string;
}

export interface FlatSemanticRegistryModule {
  readonly schema: 'b8g-semantic-registry-v1';
  readonly module: string;
  readonly abi_hash: string;
  readonly impl_hash: string;
  readonly blob_sha256: string;
  readonly symbols: readonly SemanticSymbolEntry[];
}

function sha256Text(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Strip C/C++/TS line & block comments while preserving string literals. */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let inStr: string | null = null;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\' && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Tokenize stripped source into normalized lexical tokens (identifiers, numbers, strings, punctuation). */
export function tokenizeCanonical(src: string): string[] {
  const clean = stripComments(src);
  const tokens: string[] = [];
  const re = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||->|::|[{}()[\];,.<>+\-*/%&|^!~?:=]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

/**
 * Extracts C/TS parameter types & names from a parameter token list, returning:
 * - canonicalTypes: parameter type sequence stripped of parameter identifier names
 * - paramNames: ordered parameter names for De Bruijn alpha-canonicalization ($0, $1, ...)
 */
function parseParamList(paramTokens: string[]): { canonicalTypes: string; paramNames: string[] } {
  if (paramTokens.length === 0 || (paramTokens.length === 1 && paramTokens[0] === 'void')) {
    return { canonicalTypes: 'void', paramNames: [] };
  }
  const groups: string[][] = [];
  let cur: string[] = [];
  let depth = 0;
  for (const t of paramTokens) {
    if (t === '(' || t === '<' || t === '[') depth++;
    else if (t === ')' || t === '>' || t === ']') depth--;
    if (t === ',' && depth === 0) {
      if (cur.length) groups.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length) groups.push(cur);

  const types: string[] = [];
  const names: string[] = [];
  for (const g of groups) {
    const colonIdx = g.indexOf(':');
    if (colonIdx > 0) {
      // TypeScript style: `name: Type`
      names.push(g[0]!);
      types.push(g.slice(colonIdx + 1).join(' '));
    } else if (g.length >= 2 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(g[g.length - 1]!)) {
      // C style: `const char *name`
      names.push(g[g.length - 1]!);
      types.push(g.slice(0, -1).join(' '));
    } else {
      types.push(g.join(' '));
    }
  }
  return { canonicalTypes: types.join(','), paramNames: names };
}

/** Alpha-canonicalize a function body by replacing parameter names with De Bruijn indices ($0, $1, ...). */
function alphaCanonicalizeBody(bodyTokens: string[], paramNames: string[]): string {
  const binder = new Map<string, string>();
  paramNames.forEach((p, idx) => binder.set(p, `$${idx}`));
  let nextLocal = paramNames.length;
  const out: string[] = [];

  for (let i = 0; i < bodyTokens.length; i++) {
    const tok = bodyTokens[i]!;
    // Track simple local variable declarations (`const x =`, `let x =`, `int x =`)
    if (
      (tok === 'const' || tok === 'let' || tok === 'var' || tok === 'int' || tok === 'uint32_t' || tok === 'int32_t' || tok === 'size_t') &&
      i + 2 < bodyTokens.length &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(bodyTokens[i + 1]!) &&
      (bodyTokens[i + 2] === '=' || bodyTokens[i + 2] === ':' || bodyTokens[i + 2] === ';')
    ) {
      const localName = bodyTokens[i + 1]!;
      if (!binder.has(localName)) {
        binder.set(localName, `$${nextLocal++}`);
      }
    }
    out.push(binder.get(tok) ?? tok);
  }
  return out.join(' ');
}

/**
 * Computes Dual-Layer Semantic Hashes (`abi_hash` + `impl_hash`) for a C/C++/TS source file.
 */
export function computeSemanticModuleEntry(moduleName: string, sourceText: string): FlatSemanticRegistryModule {
  const tokens = tokenizeCanonical(sourceText);
  const symbols: SemanticSymbolEntry[] = [];

  let i = 0;
  while (i < tokens.length) {
    // Detect function definitions or prototypes: `<ret...> <name> ( <params> ) { <body> }` or `;`
    if (
      i + 2 < tokens.length &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(tokens[i]!) &&
      tokens[i + 1] === '(' &&
      tokens[i] !== 'if' &&
      tokens[i] !== 'for' &&
      tokens[i] !== 'while' &&
      tokens[i] !== 'switch' &&
      tokens[i] !== 'return' &&
      tokens[i] !== 'sizeof'
    ) {
      const fnName = tokens[i]!;
      // Walk backward slightly for return type prefix (up to `;`, `}`, `{`, or start)
      let retStart = i - 1;
      while (
        retStart >= 0 &&
        tokens[retStart] !== ';' &&
        tokens[retStart] !== '}' &&
        tokens[retStart] !== '{'
      ) {
        retStart--;
      }
      const retTokens = tokens
        .slice(retStart + 1, i)
        .filter((t) => t !== 'export' && t !== 'function' && t !== 'extern' && t !== 'static' && t !== 'inline');

      // Scan parameter list
      let p = i + 2;
      let pDepth = 1;
      const paramTokens: string[] = [];
      while (p < tokens.length && pDepth > 0) {
        if (tokens[p] === '(') pDepth++;
        else if (tokens[p] === ')') pDepth--;
        if (pDepth > 0) paramTokens.push(tokens[p]!);
        p++;
      }

      // Optional TS return type `: RetType`
      let tsRet = '';
      if (tokens[p] === ':') {
        p++;
        const rt: string[] = [];
        while (p < tokens.length && tokens[p] !== '{' && tokens[p] !== ';') {
          rt.push(tokens[p]!);
          p++;
        }
        tsRet = rt.join(' ');
      }

      const { canonicalTypes, paramNames } = parseParamList(paramTokens);
      const retSig = tsRet || retTokens.join(' ') || 'void';
      const canonicalSignature = `${fnName}(${canonicalTypes})->${retSig}`;

      if (tokens[p] === '{') {
        let bDepth = 1;
        const bodyTokens: string[] = [];
        p++;
        while (p < tokens.length && bDepth > 0) {
          if (tokens[p] === '{') bDepth++;
          else if (tokens[p] === '}') bDepth--;
          if (bDepth > 0) bodyTokens.push(tokens[p]!);
          p++;
        }
        const canonicalBody = alphaCanonicalizeBody(bodyTokens, paramNames);
        symbols.push({
          name: fnName,
          kind: 'function',
          canonicalSignature,
          abi_hash: sha256Text(canonicalSignature),
          impl_hash: sha256Text(`${canonicalSignature}::${canonicalBody}`),
        });
        i = p;
        continue;
      } else if (tokens[p] === ';') {
        symbols.push({
          name: fnName,
          kind: 'declaration',
          canonicalSignature,
          abi_hash: sha256Text(canonicalSignature),
          impl_hash: sha256Text(canonicalSignature),
        });
        i = p + 1;
        continue;
      }
    }
    i++;
  }

  // Canonical sort by symbol name so declaration reordering produces zero hash churn
  symbols.sort((a, b) => a.name.localeCompare(b.name));

  const abiDigestInput = symbols.map((s) => `${s.name}:${s.abi_hash}`).join('\n');
  const implDigestInput = symbols.length
    ? symbols.map((s) => `${s.name}:${s.impl_hash}`).join('\n')
    : tokens.join(' ');

  return {
    schema: 'b8g-semantic-registry-v1',
    module: moduleName,
    abi_hash: sha256Text(abiDigestInput),
    impl_hash: sha256Text(implDigestInput),
    blob_sha256: sha256Text(sourceText),
    symbols,
  };
}

if (process.argv[1]?.endsWith('semantic-registry.mts') && process.argv[2]) {
  const inputPaths = process.argv.slice(2).filter((a) => !a.startsWith('--out='));
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const entries = inputPaths.map((p) => computeSemanticModuleEntry(basename(p), readFileSync(p, 'utf8')));
  const json = JSON.stringify({ schema: 'b8g-flat-semantic-registry-v1', generated_at: new Date().toISOString(), modules: entries }, null, 2) + '\n';
  if (outArg) {
    writeFileSync(outArg.slice('--out='.length), json);
  } else {
    console.log(json);
  }
}
