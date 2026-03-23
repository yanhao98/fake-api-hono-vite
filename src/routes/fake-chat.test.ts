import { describe, it, expect } from 'vitest'
import chat from './fake-chat'

describe('GET /v1/models', () => {
  it('should return model list', async () => {
    const res = await chat.request('/v1/models')
    expect(res.status).toBe(200)

    const json: any = await res.json()
    expect(json.object).toBe('list')
    expect(json.data).toHaveLength(2)
    expect(json.data[0]).toMatchObject({
      id: 'gpt-5-nano',
      object: 'model',
      owned_by: 'openai',
    })
    expect(json.data[1]).toMatchObject({
      id: 'gpt-3.5-turbo',
      object: 'model',
      owned_by: 'openai',
    })
  })
})

describe('POST /v1/chat/completions', () => {
  const requestBody = {
    model: 'gpt-5-nano',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: false,
  }

  it('should return non-streaming response in OpenAI format', async () => {
    const res = await chat.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    expect(res.status).toBe(200)

    const json: any = await res.json()
    expect(json.id).toMatch(/^chatcmpl-/)
    expect(json.object).toBe('chat.completion')
    expect(json.model).toBe('gpt-5-nano')
    expect(json.created).toBeTypeOf('number')

    // choices
    expect(json.choices).toHaveLength(1)
    const choice = json.choices[0]
    expect(choice.index).toBe(0)
    expect(choice.finish_reason).toBe('stop')
    expect(choice.message.role).toBe('assistant')
    expect(choice.message.content).toBeTypeOf('string')
    expect(choice.message.content.length).toBeGreaterThan(0)

    // usage
    expect(json.usage).toMatchObject({
      prompt_tokens: 10,
      completion_tokens: 17,
      total_tokens: 27,
    })
  })

  it('should use default model when not specified', async () => {
    const res = await chat.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      }),
    })
    const json: any = await res.json()
    expect(json.model).toBe('gpt-35-turbo')
  })

  it('should return streaming response with SSE format', async () => {
    const res = await chat.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        stream: true,
      }),
    })
    expect(res.status).toBe(200)

    const text = await res.text()
    const lines = text.split('\n').filter((l: string) => l.startsWith('data: '))

    // Should have: role chunk + character chunks + finish chunk + content_filter chunk + usage chunk + [DONE]
    expect(lines.length).toBeGreaterThanOrEqual(4)

    // First chunk should contain role
    const firstChunk = JSON.parse(lines[0].replace('data: ', ''))
    expect(firstChunk.object).toBe('chat.completion.chunk')
    expect(firstChunk.choices[0].delta.role).toBe('assistant')
    expect(firstChunk.model).toBe('gpt-5-nano')

    // Last line should be [DONE]
    const lastDataLine = lines[lines.length - 1]
    expect(lastDataLine).toBe('data: [DONE]')

    // Find the finish_reason chunk
    const finishChunk = lines.find((l: string) => {
      if (l === 'data: [DONE]') return false
      const parsed = JSON.parse(l.replace('data: ', ''))
      return parsed.choices?.[0]?.finish_reason === 'stop'
    })
    expect(finishChunk).toBeDefined()

    // Find usage chunk
    const usageChunk = lines.find((l: string) => {
      if (l === 'data: [DONE]') return false
      const parsed = JSON.parse(l.replace('data: ', ''))
      return parsed.usage !== undefined
    })
    expect(usageChunk).toBeDefined()
    const usageData = JSON.parse(usageChunk!.replace('data: ', ''))
    expect(usageData.usage.prompt_tokens).toBe(10)
    expect(usageData.usage.total_tokens).toBeGreaterThan(10)
  })
})
