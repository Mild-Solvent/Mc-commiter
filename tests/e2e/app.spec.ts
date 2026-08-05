import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('launches the secure floating bubble and opens its menu', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'commit-bubble-e2e-'))
  const electronApp = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`]
  })
  try {
    const window = await electronApp.firstWindow()
    await expect(window.locator('.commit-orb')).toBeVisible()
    await window.locator('.menu-orb').click()
    await expect(window.getByRole('heading', { name: 'Repositories' })).toBeVisible()
    await expect(window.getByText('Add your first repository')).toBeVisible()
  } finally {
    await electronApp.close()
    await rm(userData, { recursive: true, force: true })
  }
})
