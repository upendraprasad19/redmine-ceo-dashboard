const { test, expect } = require('@playwright/test')

test.describe('Critical Paths', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/.*login/)
  })

  test('API health check', async ({ request }) => {
    const response = await request.get('/api/overview')
    // Should return 401 (unauthenticated) or 200, not 500
    expect(response.status()).not.toBe(500)
  })
})
