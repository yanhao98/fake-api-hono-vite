import { describe, it, expect } from 'vitest'
import app from './index'

describe('GET /', () => {
  it('should return HTML containing Hello!', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)

    const html = await res.text()
    expect(html).toContain('Hello!')
  })
})
