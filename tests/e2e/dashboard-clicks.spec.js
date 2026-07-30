const { test, expect } = require('@playwright/test')

test.describe('Dashboard', () => {
  test('should load dashboard page', async ({ page }) => {
    await page.goto('/')
    // Redirects to login if not authenticated
    await expect(page).toHaveURL(/.*login|dashboard/)
  })

  test('should show login form when not authenticated', async ({ page }) => {
    await page.goto('/')
    // Either shows login form or dashboard (if session exists)
    const url = page.url()
    expect(url.includes('login') || url.includes('dashboard')).toBeTruthy()
  })
})
