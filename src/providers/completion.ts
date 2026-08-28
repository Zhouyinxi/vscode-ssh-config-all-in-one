/* eslint-disable no-template-curly-in-string */
import type {
  CompletionItemProvider,
  Disposable,
  Position,
  TextDocument,
} from 'vscode'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  CompletionItem,
  CompletionItemKind,
  languages,
  MarkdownString,
  SnippetString,
} from 'vscode'
import { SSH_CONFIG_OPTIONS } from '../models/SSHHost'
import { DOCUMENT_PROVIDER } from './utils'

const blockKeywords = new Set(['Host', 'Match'])
const topLevelKeywords = ['Host', 'Match', 'Include']
const INCLUDE_RE = /^Include\s+(\S*)$/

const ENUM_VALUES: Record<string, readonly string[]> = {
  LogLevel: ['QUIET', 'FATAL', 'ERROR', 'INFO', 'VERBOSE', 'DEBUG', 'DEBUG1', 'DEBUG2', 'DEBUG3'],
  StrictHostKeyChecking: ['yes', 'no', 'ask'],
  AddKeysToAgent: ['yes', 'no', 'ask', 'confirm'],
  ControlMaster: ['yes', 'no', 'ask', 'auto', 'autoask'],
  RequestTTY: ['no', 'yes', 'force', 'auto'],
  AddressFamily: ['any', 'inet', 'inet6'],
  FingerprintHash: ['md5', 'sha256'],
  ForwardAgent: ['yes', 'no'],
  ForwardX11: ['yes', 'no'],
  Compression: ['yes', 'no'],
  PubkeyAuthentication: ['yes', 'no'],
  PasswordAuthentication: ['yes', 'no'],
  BatchMode: ['yes', 'no'],
  IdentitiesOnly: ['yes', 'no'],
  TCPKeepAlive: ['yes', 'no'],
  GatewayPorts: ['yes', 'no'],
  ExitOnForwardFailure: ['yes', 'no'],
  UseKeychain: ['yes', 'no'],
}

function isInHostBlock(document: TextDocument, line: number): boolean {
  for (let i = line - 1; i >= 0; i--) {
    const text = document.lineAt(i).text
    if (/^\s*$/.test(text))
      continue
    return /^\s/.test(text) || /^(?:Host|Match)\s/i.test(text)
  }
  return false
}

function resolveIncludeBasePath(partial: string): { dir: string, prefix: string } {
  if (partial.startsWith('~')) {
    const expanded = partial.replace(/^~/, homedir())
    const dir = partial.endsWith('/') ? expanded : dirname(expanded)
    const prefix = partial.endsWith('/') ? '' : basename(expanded)
    return { dir, prefix }
  }
  if (partial.startsWith('/')) {
    const dir = partial.endsWith('/') ? partial : dirname(partial)
    const prefix = partial.endsWith('/') ? '' : basename(partial)
    return { dir, prefix }
  }
  // No prefix: relative to ~/.ssh/
  const sshDir = join(homedir(), '.ssh')
  if (!partial) {
    return { dir: sshDir, prefix: '' }
  }
  const fullPath = join(sshDir, partial)
  const dir = partial.endsWith('/') ? fullPath : dirname(fullPath)
  const prefix = partial.endsWith('/') ? '' : basename(fullPath)
  return { dir, prefix }
}

export class SSHCompletionItemsProvider implements CompletionItemProvider {
  constructor(disposables: Disposable[]) {
    disposables.push(languages.registerCompletionItemProvider(DOCUMENT_PROVIDER, this, ' ','/', '~'))
  }

  async provideCompletionItems(document: TextDocument, position: Position): Promise<CompletionItem[] | undefined> {
    const line = document.lineAt(position.line)
    const prefix = line.text.slice(0, position.character)

    if (/^\s*#/.test(prefix))
      return undefined
    if (/^\s*Host\s/i.test(prefix))
      return undefined
    // Check if we're typing a path after Include
    const includeMatch = INCLUDE_RE.exec(prefix.trimEnd())
    if (includeMatch) {
      return this.providePathCompletions(includeMatch[1])
    }

    const valueMatch = /^\s*(\w+)\s+$/.exec(prefix)
    if (valueMatch) {
      const values = ENUM_VALUES[valueMatch[1]]
      if (values) {
        return values.map((v) => {
          const item = new CompletionItem(v, CompletionItemKind.Value)
          item.sortText = v
          return item
        })
      }
      return undefined
    }

    const inBlock = isInHostBlock(document, position.line)
    const items: CompletionItem[] = []

    if (!inBlock) {
      for (const label of topLevelKeywords) {
        const opt = SSH_CONFIG_OPTIONS.find(o => o.label === label)
        const item = new CompletionItem(label, CompletionItemKind.Keyword)
        item.documentation = new MarkdownString(opt?.documentation || '')
        item.sortText = `0-${label}`
        items.push(item)
      }
      items.push(this.createHostSnippet())
      items.push(this.createTunnelsSnippet())
      items.push(this.createIncusSnippet())
    }
    else {
      for (const opt of SSH_CONFIG_OPTIONS) {
        if (blockKeywords.has(opt.label))
          continue
        const item = new CompletionItem(opt.label, CompletionItemKind.Property)
        item.documentation = new MarkdownString(opt.documentation)
        item.insertText = this.getInsertText(opt.label)
        if (ENUM_VALUES[opt.label]) {
          item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger value suggestions' }
        }
        item.sortText = opt.label
        items.push(item)
      }
    }

    return items
  }

  private providePathCompletions(partial: string): CompletionItem[] {
    const { dir, prefix } = resolveIncludeBasePath(partial)

    if (!existsSync(dir))
      return []

    let entries: string[]
    try {
      entries = readdirSync(dir)
    }
    catch {
      return []
    }

    const filtered = prefix ? entries.filter(e => e.startsWith(prefix)) : entries
    const items: CompletionItem[] = []

    for (const entry of filtered) {
      if (entry.startsWith('.'))
        continue

      const fullPath = join(dir, entry)
      let isDir = false
      try {
        isDir = statSync(fullPath).isDirectory()
      }
      catch {
        continue
      }

      // / is a word boundary in VS Code, so insertText = just the entry name.
      // VS Code replaces only the last path component automatically.
      if (isDir) {
        const item = new CompletionItem(entry, CompletionItemKind.Folder)
        item.insertText = `${entry}/`
        item.sortText = `0-${entry}`
        items.push(item)
      }
      else {
        const item = new CompletionItem(entry, CompletionItemKind.File)
        item.insertText = entry
        item.sortText = `1-${entry}`
        items.push(item)
      }
    }

    return items
  }

  private getInsertText(label: string): SnippetString | string {
    // Keys with enum values: insert "Key + space" only (values are triggered via command)
    if (ENUM_VALUES[label])
      return `${label} `

    // Keys with placeholders: keep the placeholder snippet
    switch (label) {
      case 'HostName':
        return new SnippetString('HostName ${1:hostname}')
      case 'User':
        return new SnippetString('User ${1:user}')
      case 'Port':
        return new SnippetString('Port ${1:22}')
      case 'IdentityFile':
        return new SnippetString('IdentityFile ${1:~/.ssh/id_rsa}')
      case 'ProxyCommand':
        return new SnippetString('ProxyCommand ${1:nc -X 5 -x localhost:1080 %h %p}')
      case 'ProxyJump':
        return new SnippetString('ProxyJump ${1:jump-host}')
      case 'Include':
        return new SnippetString('Include ${1:~/.ssh/config.d/*.conf}')
      case 'LocalForward':
        return new SnippetString('LocalForward ${1:8080} ${2:localhost:80}')
      case 'RemoteForward':
        return new SnippetString('RemoteForward ${1:8080} ${2:localhost:80}')
      case 'DynamicForward':
        return new SnippetString('DynamicForward ${1:1080}')
      case 'ServerAliveInterval':
        return new SnippetString('ServerAliveInterval ${1:60}')
      case 'ServerAliveCountMax':
        return new SnippetString('ServerAliveCountMax ${1:3}')
      case 'ConnectTimeout':
        return new SnippetString('ConnectTimeout ${1:10}')
      default:
        return `${label} `
    }
  }

  private createHostSnippet(): CompletionItem {
    const item = new CompletionItem('Host (template)', CompletionItemKind.Snippet)
    item.documentation = 'Insert a basic Host configuration template.'
    item.insertText = new SnippetString('Host ${1:alias}\n    HostName ${2:hostname}\n    User ${3:user}\n    Port ${4:22}')
    item.sortText = '1-host-tpl'
    return item
  }

  private createTunnelsSnippet(): CompletionItem {
    const item = new CompletionItem('Configure Tunnels', CompletionItemKind.Snippet)
    item.documentation = 'Insert a template for configuring a tunnel connection.'
    item.insertText = new SnippetString('Host ${1:alias}\n    HostName ${2:fqn}\n    LocalForward ${4:port} ${5:localhost}:${4:port}\n    User ${6:user}')
    item.sortText = '2-tunnels'
    return item
  }

  private createIncusSnippet(): CompletionItem {
    const item = new CompletionItem('Configure Incus', CompletionItemKind.Snippet)
    item.documentation = 'Creates incus and root-incus on demand.'
    item.insertText = new SnippetString('Host ${1:alias}\n  HostName ${1:alias}.incus\n  User dev\n\nHost root-${1:alias}\n  HostName root-${1:fqn}.incus\n')
    item.sortText = '3-incus'
    return item
  }
}
