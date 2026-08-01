import * as vscode from "vscode";
import {
  extractChecks,
  checkContrast,
  extractTouchTargetChecks,
  checkTouchTargets,
  extractFocusIndicatorChecks,
  checkFocusIndicators,
  resolveTheme,
} from "tailwind-a11y";
import { formatViolation, type AnyViolation } from "./format.js";

const SUPPORTED_LANGUAGES = new Set(["javascriptreact", "typescriptreact"]);
const DEBOUNCE_MS = 300;

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("tailwind-a11y");
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const refresh = (doc: vscode.TextDocument): void => {
    if (!SUPPORTED_LANGUAGES.has(doc.languageId)) return;
    try {
      collection.set(doc.uri, analyze(doc));
    } catch (err) {
      // Mirrors cli.ts's per-file try/catch: one document the engine can't
      // handle shouldn't take down diagnostics for every other open file,
      // or abort the activation-time sweep over already-open documents.
      console.error(`tailwind-a11y: failed to analyze ${doc.uri.fsPath}: ${(err as Error).message}`);
    }
  };

  const scheduleRefresh = (doc: vscode.TextDocument): void => {
    if (!SUPPORTED_LANGUAGES.has(doc.languageId)) return;
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        refresh(doc);
      }, DEBOUNCE_MS)
    );
  };

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidSaveTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleRefresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      clearTimeout(timers.get(key));
      timers.delete(key);
      collection.delete(doc.uri);
    }),
    new vscode.Disposable(() => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    })
  );

  // onDidOpenTextDocument doesn't replay for documents already open when the
  // extension activates.
  for (const doc of vscode.workspace.textDocuments) refresh(doc);
}

function analyze(doc: vscode.TextDocument): vscode.Diagnostic[] {
  const text = doc.getText();
  const file = doc.uri.fsPath;

  // Resolved fresh on every call rather than cached -- fine performance-wise
  // since edits are already 300ms-debounced, and it's what makes an edit to
  // tailwind.config.js itself actually get picked up (relies on the engine's
  // own require-cache busting in loadCustomTheme, not any caching here).
  const rootDir = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? null;
  const { palette, spacing } = resolveTheme({ rootDir });

  const violations: AnyViolation[] = [
    ...checkContrast(extractChecks(text, file), palette),
    ...checkTouchTargets(extractTouchTargetChecks(text, file, spacing)),
    ...checkFocusIndicators(extractFocusIndicatorChecks(text, file)),
  ];

  return violations.map((v) => {
    const diagnostic = new vscode.Diagnostic(lineRange(doc, v.line), formatViolation(v), vscode.DiagnosticSeverity.Warning);
    diagnostic.source = "tailwind-a11y";
    diagnostic.code = v.type;
    return diagnostic;
  });
}

// The engine reports a 1-based line and no column. VS Code's Range is
// 0-based, and a zero-width range renders no squiggle at all — so underline
// the whole trimmed line instead.
function lineRange(doc: vscode.TextDocument, line: number): vscode.Range {
  const index = Math.min(Math.max(line - 1, 0), doc.lineCount - 1);
  const textLine = doc.lineAt(index);
  return textLine.isEmptyOrWhitespace
    ? textLine.range
    : new vscode.Range(index, textLine.firstNonWhitespaceCharacterIndex, index, textLine.range.end.character);
}

export function deactivate(): void {}
