import type { HostEntry } from './sshConfigParser'

function formatRemoteForward(remoteForward: string): string {
  return remoteForward.trim().replace(/\s+/, ':')
}

export function buildSSHCommand(host: HostEntry): string {
  const target = host.hostname || host.host
  const userPrefix = host.user ? `${host.user}@` : ''
  let command = `ssh ${userPrefix}${target}`

  if (host.port && host.port !== '22')
    command += ` -p ${host.port}`
  if (host.identityFile)
    command += ` -i ${host.identityFile}`
  for (const remoteForward of host.remoteForwards || [])
    command += ` -R ${formatRemoteForward(remoteForward)}`
  if (host.forwardX11 === true)
    command += ' -X'
  else if (host.forwardX11 === false)
    command += ' -x'

  return command
}
