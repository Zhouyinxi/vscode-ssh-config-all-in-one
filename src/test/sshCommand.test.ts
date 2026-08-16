import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSSHCommand } from '../utils/sshCommand'
import { parseSSHConfigContent } from '../utils/sshConfigParser'

test('builds the complete command from issue 29', () => {
  const [host] = parseSSHConfigContent(`Host HNROBERT-Server
  HostName hnrobert.site
  User user
  RemoteForward 1080 127.0.0.1:7890
  Port 11451
  ForwardX11 yes
`, '/tmp/config')

  assert.deepEqual(host.remoteForwards, ['1080 127.0.0.1:7890'])
  assert.equal(host.forwardX11, true)
  assert.equal(
    buildSSHCommand(host),
    'ssh user@hnrobert.site -p 11451 -R 1080:127.0.0.1:7890 -X',
  )
})

test('keeps repeated remote forwards and explicit X11 disabling', () => {
  const [host] = parseSSHConfigContent(`Host tunnel
  HostName tunnel.example.com
  RemoteForward 1080 127.0.0.1:7890
  RemoteForward 1081 127.0.0.1:7891
  ForwardX11 no
`, '/tmp/config')

  assert.equal(
    buildSSHCommand(host),
    'ssh tunnel.example.com -R 1080:127.0.0.1:7890 -R 1081:127.0.0.1:7891 -x',
  )
})

test('preserves the existing user, port, and identity command format', () => {
  const [host] = parseSSHConfigContent(`Host key-server
  HostName key.example.com
  User root
  Port 2222
  IdentityFile ~/.ssh/id_ed25519
`, '/tmp/config')

  assert.equal(
    buildSSHCommand(host),
    'ssh root@key.example.com -p 2222 -i ~/.ssh/id_ed25519',
  )
})
