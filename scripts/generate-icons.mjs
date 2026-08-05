import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const source = await readFile(resolve('build/icon.svg'))
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(
  sizes.map((size) => sharp(source).resize(size, size).png().toBuffer())
)
await writeFile(resolve('build/icon.png'), pngs.at(-1))
await writeFile(resolve('build/icon.ico'), await pngToIco(pngs))
