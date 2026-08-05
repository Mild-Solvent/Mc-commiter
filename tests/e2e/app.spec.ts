import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('launches the guided first-run setup', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'commit-bubble-e2e-'))
  const electronApp = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`]
  })
  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: 'Let’s get you ready in a few clicks.' })).toBeVisible()
    await expect(window.getByText('Local-first')).toBeVisible()
    await window.getByRole('button', { name: /Continue/ }).click()
    await expect(window.getByRole('heading', { name: 'Pick a Git repository' })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Choose repository folder' })).toBeVisible()
  } finally {
    await electronApp.close()
    await rm(userData, { recursive: true, force: true })
  }
})
