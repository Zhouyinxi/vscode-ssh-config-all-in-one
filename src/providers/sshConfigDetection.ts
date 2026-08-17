import type { Disposable } from 'vscode'
import { languages, workspace } from 'vscode'
import { SSH_CONFIG_KEYWORDS } from '../models/SSHHost'

const KEYWORD_RE = new RegExp(`^\\s+(?:${SSH_CONFIG_KEYWORDS.join('|')})\\b`, 'i')
const BLOCK_RE = /^\s*(?:Host|Match)\s+\S/
const MAX_CHECK_LINES = 100

export function isSSHConfigContent(text: string): boolean {
  let hasBlock = false
  let hasKeyword = false

  for (const line of text.split('\n').slice(0, MAX_CHECK_LINES)) {
    if (BLOCK_RE.test(line))
      hasBlock = true
    if (KEYWORD_RE.test(line))
      hasKeyword = true
    if (hasBlock && hasKeyword)
      return true
  }

  return false
}

export function registerSSHConfigDetection(disposables: Disposable[]): void {
  disposables.push(workspace.onDidOpenTextDocument(async (doc) => {
    const cfg = workspace.getConfiguration('sshConfigAllInOne.detection')
    if (!cfg.get<boolean>('enabled', true))
      return

    if (doc.languageId === 'ssh_config')
      return

    // Only check files whose language is not already identified as a specific language
    const knownLangs = new Set([
      'json',
      'yaml',
      'yml',
      'xml',
      'html',
      'css',
      'javascript',
      'typescript',
      'python',
      'java',
      'c',
      'cpp',
      'go',
      'rust',
      'ruby',
      'php',
      'sql',
      'sh',
      'bash',
      'powershell',
      'dockerfile',
      'ini',
      'toml',
      'markdown',
      'lua',
      'perl',
      'r',
      'swift',
      'kotlin',
      'dart',
      'scala',
      'groovy',
      'makefile',
      'csv',
      'properties',
      'gitignore',
      'editorconfig',
    ])
    if (knownLangs.has(doc.languageId))
      return

    // Check filename contains "config"
    const fileName = doc.uri.path.split('/').pop() ?? ''
    if (!/config/i.test(fileName))
      return

    if (!isSSHConfigContent(doc.getText()))
      return

    try {
      await languages.setTextDocumentLanguage(doc, 'ssh_config')
    }
    catch {
      // setTextDocumentLanguage can fail for untitled/invalid docs
    }
  }))
}
