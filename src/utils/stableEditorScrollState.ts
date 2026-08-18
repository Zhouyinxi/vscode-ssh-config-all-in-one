import type { TextEditor } from 'vscode'
import { Position, Range, TextEditorRevealType } from 'vscode'

/**
 * Public-extension-API counterpart of VS Code's internal
 * `StableEditorScrollState`.
 */
export class StableEditorScrollState {
  static capture(editor: TextEditor): StableEditorScrollState {
    const visiblePosition = editor.visibleRanges[0]?.start
    return new StableEditorScrollState(editor.document.uri.toString(), visiblePosition)
  }

  private constructor(
    private readonly documentUri: string,
    private readonly visiblePosition: Position | undefined,
  ) {}

  restore(editor: TextEditor): void {
    if (!this.visiblePosition || editor.document.uri.toString() !== this.documentUri)
      return

    const currentVisiblePosition = editor.visibleRanges[0]?.start
    if (currentVisiblePosition?.line === this.visiblePosition.line)
      return

    const line = Math.min(this.visiblePosition.line, editor.document.lineCount - 1)
    const character = Math.min(
      this.visiblePosition.character,
      editor.document.lineAt(line).text.length,
    )
    const position = new Position(line, character)
    editor.revealRange(new Range(position, position), TextEditorRevealType.AtTop)
  }
}
