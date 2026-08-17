import type { Disposable, HoverProvider, Position, TextDocument } from 'vscode'
import { Hover, languages } from 'vscode'
import { SSH_CONFIG_OPTIONS } from '../models/SSHHost'
import { DOCUMENT_PROVIDER } from './utils'

const optionsMap = new Map(
  SSH_CONFIG_OPTIONS.map(option => [option.label, option.documentation]),
)

/**
 * Provides hover information for SSH configuration options.
 */
export class SSHHoverProvider implements HoverProvider {
  /**
   * Constructs a new instance of SSHHoverProvider.
   * @param disposables - The array of disposables to which the hover provider will be added.
   */
  constructor(disposables: Disposable[]) {
    disposables.push(languages.registerHoverProvider(DOCUMENT_PROVIDER, this))
  }

  /**
   * Provides hover information for the given document and position.
   * @param document - The text document.
   * @param position - The position in the document.
   * @returns A hover object containing the hover information.
   */
  async provideHover(document: TextDocument, position: Position) {
    const wordRange = document.getWordRangeAtPosition(position)
    if (!wordRange) {
      return
    }

    const word = document.getText(wordRange)

    const documentation = optionsMap.get(word)
    if (documentation) {
      const hoverContent = [`**${word}**`, `\`\`\`\n${documentation}\n\`\`\``]
      return new Hover(hoverContent)
    }
  }
}
