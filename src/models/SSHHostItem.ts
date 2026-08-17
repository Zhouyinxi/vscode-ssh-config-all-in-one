import type { SSHHost } from './SSHHost'
import { ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode'

export class SSHHostItem extends TreeItem {
  constructor(
    public readonly sshHost: SSHHost,
    hasRecentFolders: boolean,
    isConnected: boolean = false,
    isCollapsed: boolean = false,
    nonce?: number,
  ) {
    // Determine collapsible state based on whether it has folders and collapse state
    let state: TreeItemCollapsibleState
    if (!hasRecentFolders) {
      state = TreeItemCollapsibleState.None
    }
    else if (isCollapsed) {
      state = TreeItemCollapsibleState.Collapsed
    }
    else {
      state = TreeItemCollapsibleState.Expanded
    }

    super(sshHost.host, state)
    this.id = nonce != null ? `${sshHost.configFile}:${sshHost.host}::${nonce}` : `${sshHost.configFile}:${sshHost.host}`
    this.contextValue = isConnected ? 'host-connected' : 'host'

    // Use 'vm-active' icon with green color for connected hosts
    if (isConnected) {
      this.iconPath = new ThemeIcon('vm-active', new ThemeColor('charts.green'))
      this.tooltip = `SSH Host: ${sshHost.host} (Connected)`
    }
    else {
      this.iconPath = new ThemeIcon('vm')
      this.tooltip = `SSH Host: ${sshHost.host}`
    }

    this.description = sshHost.hostname
  }

  get hostName(): string {
    return this.sshHost.host
  }

  get configFile(): string {
    return this.sshHost.configFile
  }

  get lineNumber(): number {
    return this.sshHost.lineNumber
  }
}
