/** Checks that authored TypeScript files and function implementations have English documentation. */
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

/** Collects authored TypeScript files while excluding generated and third-party code. */
async function collect(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await collect(path));
    else if (/\.tsx?$/.test(entry.name)) paths.push(path);
  }
  return paths;
}

/** Finds a documentation comment on a function or its containing declaration or call. */
function documented(node: ts.Node, source: ts.SourceFile): boolean {
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    const leading = source.text.slice(current.getFullStart(), current.getStart(source));
    if (/\/\*[^]*?[A-Za-z]{3}|\/\/[^\n]*[A-Za-z]{3}/.test(leading)) return true;
    if (ts.isStatement(current) || ts.isJsxExpression(current)) break;
    current = current.parent;
  }
  return false;
}

/** Reports missing file and function comments with their source locations. */
async function main(): Promise<void> {
  const files = [...await collect("src"), ...await collect("scripts"), ...await collect("tests")];
  const failures: string[] = [];
  for (const path of files) {
    const text = await readFile(path, "utf8");
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    if (!/^\s*\/\*\*?\s*[A-Za-z]/.test(text)) failures.push(`${path}: missing English file comment`);
    /** Visits function implementations without treating type signatures as executable functions. */
    function visit(node: ts.Node): void {
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body && !documented(node, source)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        failures.push(`${path}:${line}: missing function comment`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(`Documentation comments verified in ${files.length} authored TypeScript files.`);
}
await main();
