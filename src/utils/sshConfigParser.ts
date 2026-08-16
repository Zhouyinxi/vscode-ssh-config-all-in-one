export interface HostEntry {
  host: string
  hostname?: string
  user?: string
  port?: string
  identityFile?: string
  remoteForwards?: string[]
  forwardX11?: boolean
  configFile?: string
  lineNumber?: number
}

export function parseSSHConfigContent(content: string, configPath: string): HostEntry[] {
  const hosts: HostEntry[] = []
  let currentHost: HostEntry | null = null
  let lineNumber = 0

  for (const line of content.split('\n')) {
    lineNumber++
    const trimmed = line.trim()
    if (trimmed.startsWith('#') || trimmed === '')
      continue

    const matchHost = /^Host\s+(\S.*)$/i.exec(trimmed)
    if (matchHost) {
      if (currentHost)
        hosts.push(currentHost)
      const name = matchHost[1].trim()
      if (name.includes('*') || name.includes('?'))
        continue
      currentHost = {
        host: name,
        configFile: configPath,
        lineNumber,
      }
      continue
    }

    if (currentHost) {
      const matchHostname = /^\s*HostName\s+(\S.*)$/i.exec(trimmed)
      if (matchHostname) {
        currentHost.hostname = matchHostname[1].trim()
        continue
      }
      const matchUser = /^\s*User\s+(\S.*)$/i.exec(trimmed)
      if (matchUser) {
        currentHost.user = matchUser[1].trim()
        continue
      }
      const matchPort = /^\s*Port\s+(\S.*)$/i.exec(trimmed)
      if (matchPort) {
        currentHost.port = matchPort[1].trim()
        continue
      }
      const matchIdentityFile = /^\s*IdentityFile\s+(\S.*)$/i.exec(trimmed)
      if (matchIdentityFile) {
        currentHost.identityFile = matchIdentityFile[1].trim()
        continue
      }
      const matchRemoteForward = /^\s*RemoteForward\s+(\S.*)$/i.exec(trimmed)
      if (matchRemoteForward) {
        const remoteForward = matchRemoteForward[1].trim()
        currentHost.remoteForwards = [...(currentHost.remoteForwards || []), remoteForward]
        continue
      }
      const matchForwardX11 = /^\s*ForwardX11\s+(yes|no)$/i.exec(trimmed)
      if (matchForwardX11)
        currentHost.forwardX11 = matchForwardX11[1].toLowerCase() === 'yes'
    }
  }

  if (currentHost)
    hosts.push(currentHost)

  return hosts
}
