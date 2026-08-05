import { copyFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve('release/Commit-Bubble-Setup-0.1.0-x64.exe')
const destination = resolve('Commit-Bubble-Setup.exe')
const info = await stat(source)
if (!info.isFile() || info.size < 1_000_000) {
  throw new Error(`Installer artifact is missing or unexpectedly small: ${source}`)
}
await copyFile(source, destination)
console.log(`Convenience installer: ${destination}`)
