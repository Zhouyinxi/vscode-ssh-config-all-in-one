import { exec, spawn } from 'node:child_process'
import { chmodSync, lstat, readFile, writeFileSync } from 'node:fs'
import { homedir, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { env, Uri, window, workspace } from 'vscode'

const execAsync = promisify(exec)

/**
 * Launches the given command in the LOCAL machine's own terminal application.
 *
 * Inside a Remote-SSH window every integrated terminal runs on the remote
 * host, so we cannot use the integrated terminal for local ssh-key copy.
 * Because the extension is `extensionKind: ["ui"]`, the extension host runs
 * locally, so `spawn()` here starts processes on the local machine. We write
 * the command to a temporary script and let the OS open it in the local
 * Terminal (macOS `.command`, Linux `.sh`, Windows `.cmd`), which provides a
 * real PTY so ssh's interactive password prompt works.
 *
 * @returns true on success, false if launching failed.
 */
function launchLocalExternalTerminal(command: string): boolean {
  const isWin = platform() === 'win32'
  const isMac = platform() === 'darwin'
  const stamp = Date.now()

  try {
    if (isWin) {
      const file = join(tmpdir(), `ssh-copy-${stamp}.cmd`)
      writeFileSync(file, `${command}\r\n@echo off\r\npause\r\n`)
      spawn('cmd.exe', ['/c', 'start', '"SSH Copy ID"', file], {
        detached: true,
        shell: false,
        stdio: 'ignore',
      }).unref()
    }
    else {
      const ext = isMac ? 'command' : 'sh'
      const file = join(tmpdir(), `ssh-copy-${stamp}.${ext}`)
      // A leading newline avoids the shell echoing the first line as a prompt.
      writeFileSync(file, `#!/bin/sh\nset -e\n${command}\n`)
      chmodSync(file, 0o755)
      if (isMac) {
        // `.command` files open in Terminal.app with a real PTY.
        spawn('open', [file], { detached: true, stdio: 'ignore' }).unref()
      }
      else {
        // Linux: try common terminal emulators in turn.
        const terminals = [
          ['x-terminal-emulator', ['-e', file]],
          ['gnome-terminal', ['--', file]],
          ['konsole', ['-e', file]],
          ['xfce4-terminal', ['-x', file]],
          ['xterm', ['-e', file]],
        ] as const
        let launched = false
        for (const [bin, args] of terminals) {
          try {
            spawn(bin, [...args], { detached: true, stdio: 'ignore' }).unref()
            launched = true
            break
          }
          catch {
            // try next
          }
        }
        if (!launched)
          throw new Error('No supported terminal emulator found')
      }
    }
    return true
  }
  catch (error) {
    window.showErrorMessage(`Failed to open a local terminal: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Creates a terminal-like object that runs on the LOCAL machine.
 *
 * Inside a Remote-SSH window every integrated terminal runs on the remote
 * host, so we open a LOCAL terminal application instead. When not in a remote
 * session the integrated terminal is already local and is used as-is.
 */
function createLocalTerminal(name: string) {
  if (env.remoteName) {
    return {
      show: () => {
        window.showInformationMessage('Opening a terminal on your LOCAL machine...')
      },
      sendText: (text: string) => launchLocalExternalTerminal(text),
    }
  }
  const term = window.createTerminal(name)
  return {
    show: () => term.show(true),
    sendText: (text: string) => term.sendText(text, true),
  }
}

let options: Promise<Option[]>

/**
 * Retrieves the options from the options.json file.
 * If the options have already been retrieved, it returns a cached Promise.
 * Otherwise, it reads the options from the file and returns a new Promise.
 * @returns A Promise that resolves to the options object.
 */
export function getOptions() {
  return options || (options = new Promise((resolve, reject) => {
    readFile(join(__dirname, '../thirdparty/options.json'), { encoding: 'utf8' }, (err: NodeJS.ErrnoException | null, content: string) => {
      err ? reject(err) : resolve(JSON.parse(content))
    })
  }))
}

/**
 * Retrieves the SSH configuration options.
 * @returns A promise that resolves to an array of Option objects.
 */
export async function getSSHConfigOptions(): Promise<Option[]> {
  return await getOptions()
}

export function openUserConfig() {
  const userConfig = process.env.USERPROFILE && join(process.env.USERPROFILE, '.ssh/config')

  if (!userConfig) {
    return window.showErrorMessage('USERPROFILE environment variable not set')
  }
  return openConfig(userConfig)
}

/**
 * Opens a configuration file at the specified path.
 * If the file exists, it will be opened in the editor.
 * If the file does not exist, a new untitled document will be created and opened.
 *
 * @param path - The path of the configuration file to open.
 * @returns A promise that resolves to the opened text document.
 */
export async function openConfig(path: string) {
  return fileExists(path)
    .then(async (exists) => {
      return workspace.openTextDocument(exists ? Uri.file(path) : Uri.file(path).with({ scheme: 'untitled' }))
        .then((document) => {
          return window.showTextDocument(document)
        })
    })
}

/**
 * Checks if a file exists at the specified path.
 * @param path - The path of the file to check.
 * @returns A promise that resolves to `true` if the file exists, or `false` otherwise.
 */
export function fileExists(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    lstat(path, (err: NodeJS.ErrnoException | null) => {
      if (!err) {
        resolve(true)
      } else if (err.code === 'ENOENT') {
        resolve(false)
      } else {
        reject(err)
      }
    })
  })
}

/**
 * Finds the SSH public key file.
 * @returns A promise that resolves to the path of the public key file, or null if not found.
 */
async function findPublicKey(): Promise<string | null> {
  const sshDir = join(homedir(), '.ssh')
  const keyTypes = ['id_rsa.pub', 'id_ed25519.pub', 'id_ecdsa.pub', 'id_dsa.pub']

  for (const keyType of keyTypes) {
    const keyPath = join(sshDir, keyType)
    if (await fileExists(keyPath)) {
      return keyPath
    }
  }

  return null
}

/**
 * Prompts the user to select an SSH public key file.
 * @returns A promise that resolves to the path of the selected public key file, or null if cancelled.
 */
async function promptSelectPublicKey(): Promise<string | null> {
  const sshDir = join(homedir(), '.ssh')
  const keyTypes = ['id_rsa.pub', 'id_ed25519.pub', 'id_ecdsa.pub', 'id_dsa.pub']

  const availableKeys: { label: string, path: string }[] = []

  for (const keyType of keyTypes) {
    const keyPath = join(sshDir, keyType)
    if (await fileExists(keyPath)) {
      availableKeys.push({ label: keyType, path: keyPath })
    }
  }

  if (availableKeys.length === 0) {
    return null
  }

  const choice = await window.showQuickPick(
    availableKeys.map(k => ({ label: k.label, description: k.path, value: k.path })),
    {
      placeHolder: 'Select the SSH public key to send',
      title: 'SSH Public Key',
    },
  )

  return choice?.value || null
}

/**
 * Prompts the user to generate SSH keys.
 * @returns A promise that resolves to true if keys were generated, false otherwise.
 */
async function promptGenerateKeys(): Promise<boolean> {
  const choice = await window.showInformationMessage(
    'No SSH key pair found. Would you like to generate one?',
    'Generate Keys',
    'Cancel',
  )

  if (choice !== 'Generate Keys') {
    return false
  }

  const terminal = createLocalTerminal('SSH Key Generation')
  terminal.show()
  terminal.sendText('ssh-keygen -t ed25519 -C "$(whoami)@$(hostname)"')

  window.showInformationMessage('Please follow the prompts in the terminal to generate your SSH key pair.')
  return false
}

/**
 * Sends the SSH public key to a remote host.
 * @param hostName - The name of the host to send the key to.
 */
export async function copyPublicKey(hostName: string) {
  try {
    const choice = await window.showQuickPick(
      [
        { label: 'Unix/Linux/Mac', value: 'unix' as const },
        { label: 'Windows', value: 'windows' as const },
      ],
      {
        placeHolder: 'Select the remote host operating system',
        title: 'Remote Host OS',
      },
    )

    if (!choice) {
      return
    }

    const remoteOS = choice.value
    const isLocalWindows = platform() === 'win32'
    let publicKeyPath: string | null = null

    const needsKeyPath = isLocalWindows || remoteOS === 'windows'

    if (needsKeyPath) {
      publicKeyPath = await findPublicKey()

      if (!publicKeyPath) {
        const shouldGenerate = await promptGenerateKeys()
        if (!shouldGenerate) {
          return
        }
        return
      }

      publicKeyPath = await promptSelectPublicKey()
      if (!publicKeyPath) {
        return
      }
    }

    if (remoteOS === 'windows') {
      await copyPublicKeyToWindowsRemote(hostName, publicKeyPath, isLocalWindows)
    }
    else {
      await copyPublicKeyToUnixRemote(hostName, publicKeyPath, isLocalWindows)
    }
  }
  catch (error) {
    window.showErrorMessage(`Failed to send public key: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Copies the SSH public key to a Unix/Linux/Mac remote host.
 * @param hostName - The name of the host to copy the key to.
 * @param publicKeyPath - The path to the public key file (optional, let ssh-copy-id choose).
 * @param isLocalWindows - Whether the local machine is Windows.
 */
async function copyPublicKeyToUnixRemote(hostName: string, publicKeyPath: string | null, isLocalWindows: boolean) {
  const terminal = createLocalTerminal('SSH Copy ID')
  terminal.show()

  if (isLocalWindows) {
    if (!publicKeyPath) {
      window.showErrorMessage('Public key path is required on Windows')
      return
    }
    const script = `type "${publicKeyPath}" | ssh ${hostName} "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && chmod 700 ~/.ssh"`
    terminal.sendText(script)
  }
  else {
    try {
      await execAsync('which ssh-copy-id')
      // Let ssh-copy-id use its default key selection
      terminal.sendText(`ssh-copy-id ${hostName}`)
    }
    catch {
      if (!publicKeyPath) {
        window.showErrorMessage('ssh-copy-id not found and no public key specified')
        return
      }
      terminal.sendText(`cat "${publicKeyPath}" | ssh ${hostName} "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && chmod 700 ~/.ssh"`)
    }
  }

  window.showInformationMessage(`Sending public key to ${hostName}. Please enter your password in the terminal.`)
}

/**
 * Resolves whether a Windows target should be treated as a regular user or an
 * administrator, honoring the `sshConfigAllInOne.copyKey.windowsUserType`
 * setting (which can short-circuit the prompt).
 */
async function resolveWindowsUserType(): Promise<'regular' | 'admin' | undefined> {
  const pref = workspace.getConfiguration('sshConfigAllInOne.copyKey').get<string>('windowsUserType', 'ask')
  if (pref === 'regular')
    return 'regular'
  if (pref === 'admin')
    return 'admin'

  const choice = await window.showQuickPick(
    [
      { label: 'Regular user', value: 'regular' as const, description: 'member of the Users group', detail: 'Copy to %USERPROFILE%\\.ssh\\authorized_keys' },
      {
        label: 'Administrator',
        value: 'admin' as const,
        description: 'member of an Administrators group',
        detail: 'Any account in an Administrators group counts — the username need not be "administrator". The first account created on a Windows machine is usually an admin. Choose between the user home and administrators_authorized_keys.',
      },
    ],
    {
      placeHolder: 'Is the target account a regular user or an administrator? (Any account in an Administrators group counts as admin.)',
      title: 'Windows target account type',
    },
  )
  return choice?.value
}

/**
 * For an administrator target, asks where the public key should be written after
 * informing the user about the default sshd_config behavior for administrators.
 */
async function promptWindowsAdminDestination(): Promise<'userHome' | 'programData' | undefined> {
  window.showInformationMessage(
    'Windows sshd_config default often contains:\n\nMatch Group administrators\n    AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys\n\nMembers of the Administrators group do NOT read ~/.ssh/authorized_keys — they only read C:\\ProgramData\\ssh\\administrators_authorized_keys.',
  )

  const choice = await window.showQuickPick(
    [
      { label: 'User home', value: 'userHome' as const, detail: '%USERPROFILE%\\.ssh\\authorized_keys' },
      { label: 'administrators_authorized_keys', value: 'programData' as const, detail: 'C:\\ProgramData\\ssh\\administrators_authorized_keys' },
    ],
    { placeHolder: 'Where should the public key be written?', title: 'Administrator — choose destination' },
  )
  return choice?.value
}

/** Builds the local shell command that copies a public key to a Windows host. */
function buildWindowsCopyScript(
  hostName: string,
  publicKeyPath: string,
  isLocalWindows: boolean,
  destination: 'userHome' | 'programData',
): string {
  const readCmd = isLocalWindows ? `type "${publicKeyPath}"` : `cat "${publicKeyPath}"`

  if (destination === 'userHome') {
    return isLocalWindows
      ? `${readCmd} | ssh ${hostName} "powershell -Command \\"New-Item -ItemType Directory -Force -Path $env:USERPROFILE\\.ssh | Out-Null; $input | Add-Content -Path $env:USERPROFILE\\.ssh\\authorized_keys\\""`
      : `${readCmd} | ssh ${hostName} "powershell -Command \\"New-Item -ItemType Directory -Force -Path \\$env:USERPROFILE\\.ssh | Out-Null; \\$input | Add-Content -Path \\$env:USERPROFILE\\.ssh\\authorized_keys\\""`
  }

  // administrators_authorized_keys — fix the ACL so Administrators/SYSTEM own it
  // and inheritance is removed (required for OpenSSH to accept the file).
  const adminsPath = 'C:\\ProgramData\\ssh\\administrators_authorized_keys'
  const acl = `icacls ${adminsPath} /inheritance:r /grant Administrators:F /grant SYSTEM:F`
  return isLocalWindows
    ? `${readCmd} | ssh ${hostName} "powershell -Command \\"$input | Add-Content -Path ${adminsPath}; ${acl}\\""`
    : `${readCmd} | ssh ${hostName} "powershell -Command \\"\\$input | Add-Content -Path ${adminsPath}; ${acl}\\""`
}

/**
 * Copies the SSH public key to a Windows remote host.
 *
 * For administrators, Windows reads keys from
 * C:\ProgramData\ssh\administrators_authorized_keys (per the default
 * `Match Group administrators` sshd_config rule) rather than the user home, so
 * the account type and destination are resolved first.
 * @param hostName - The name of the host to copy the key to.
 * @param publicKeyPath - The path to the public key file.
 * @param isLocalWindows - Whether the local machine is Windows.
 */
async function copyPublicKeyToWindowsRemote(hostName: string, publicKeyPath: string | null, isLocalWindows: boolean) {
  if (!publicKeyPath) {
    window.showErrorMessage('Public key path is required for Windows remote hosts')
    return
  }

  const userType = await resolveWindowsUserType()
  if (!userType)
    return

  let destination: 'userHome' | 'programData' = 'userHome'
  if (userType === 'admin') {
    const dest = await promptWindowsAdminDestination()
    if (!dest)
      return
    destination = dest
  }

  const terminal = createLocalTerminal('SSH Copy ID')
  terminal.show()
  terminal.sendText(buildWindowsCopyScript(hostName, publicKeyPath, isLocalWindows, destination))

  const targetDesc = destination === 'programData'
    ? 'C:\\ProgramData\\ssh\\administrators_authorized_keys'
    : '~/.ssh/authorized_keys'
  window.showInformationMessage(`Sending public key to ${hostName} (${targetDesc}). Please enter your password in the terminal.`)
}
