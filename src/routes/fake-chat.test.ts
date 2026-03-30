import { describe, expect, it } from 'vitest'
import chat from './fake-chat'

describe('GET /v1/models', () => {
  it('returns a mixed provider model list', async () => {
    const res = await chat.request('/v1/models')
    expect(res.status).toBe(200)

    const json: any = await res.json()

    expect(json.object).toBe('list')
    expect(json.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gpt-5.4', object: 'model', owned_by: 'openai' }),
        expect.objectContaining({ id: 'gemini-3-flash-preview', object: 'model', owned_by: 'google' }),
        expect.objectContaining({ id: 'claude-sonnet-4-6', object: 'model', owned_by: 'anthropic' }),
      ]),
    )
  })
})

describe('POST /v1/chat/completions', () => {
  it('returns a non-streaming OpenAI-style response', async () => {
    const res = await chat.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4',
        messages: [
          { role: 'system', content: '喜欢用 emoji 回复消息' },
          { role: 'user', content: 'what is 1+1?' },
        ],
      }),
    })

    expect(res.status).toBe(200)

    const json: any = await res.json()

    expect(json.id).toMatch(/^chatcmpl-/)
    expect(json.object).toBe('chat.completion')
    expect(json.model).toBe('gpt-5.4')
    expect(json.system_fingerprint).toMatch(/^fp_/)
    expect(json.choices).toHaveLength(1)
    expect(json.choices[0].message.role).toBe('assistant')
    expect(json.choices[0].message.content).toBeTypeOf('string')
    expect(json.choices[0].message.content.length).toBeGreaterThan(0)
    expect(json.choices[0].message.content).toContain('POST /v1/chat/completions model=gpt-5.4')
    expect(json.choices[0].finish_reason).toBe('stop')
    expect(json.usage.prompt_tokens).toBeGreaterThan(0)
    expect(json.usage.completion_tokens).toBeGreaterThan(0)
    expect(json.usage.total_tokens).toBe(json.usage.prompt_tokens + json.usage.completion_tokens)
  })

  it('returns an OpenAI-style error for the sentinel model', async () => {
    const res = await chat.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'error-test',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    })

    expect(res.status).toBe(404)
    expect(res.headers.get('x-request-id')).toMatch(/^req_/)

    const json: any = await res.json()

    expect(json).toEqual({
      error: {
        message: 'The model `error-test` does not exist or you do not have access to it.',
        type: 'invalid_request_error',
        param: null,
        code: 'model_not_found',
      },
    })
  })

  it('uses the latest default OpenAI model when omitted', async () => {
    const res = await chat.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    })

    const json: any = await res.json()
    expect(json.model).toBe('gpt-5.4')
  })

  it('streams SSE chunks for chat completions', async () => {
    const res = await chat.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        stream: true,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    })

    expect(res.status).toBe(200)

    const text = await res.text()
    const lines = text.split('\n').filter((line) => line.startsWith('data: '))

    expect(lines.length).toBeGreaterThanOrEqual(4)

    const firstChunk = JSON.parse(lines[0].replace('data: ', ''))
    expect(firstChunk.object).toBe('chat.completion.chunk')
    expect(firstChunk.model).toBe('gpt-5.4-mini')
    expect(firstChunk.choices[0].delta.role).toBe('assistant')

    const usageLine = lines.find((line) => {
      if (line === 'data: [DONE]') {
        return false
      }

      return JSON.parse(line.replace('data: ', '')).usage !== undefined
    })

    expect(usageLine).toBeDefined()

    const usageChunk = JSON.parse(usageLine!.replace('data: ', ''))
    expect(usageChunk.usage.total_tokens).toBeGreaterThan(0)

    const streamedText = lines
      .filter((line) => line !== 'data: [DONE]')
      .map((line) => JSON.parse(line.replace('data: ', '')))
      .flatMap((chunk) => chunk.choices ?? [])
      .map((choice) => choice.delta?.content ?? '')
      .join('')

    expect(streamedText).toContain('POST /v1/chat/completions model=gpt-5.4-mini')
    expect(lines.at(-1)).toBe('data: [DONE]')
  })
})

describe('POST /v1/responses', () => {
  it('returns an OpenAI Responses API payload', async () => {
    const res = await chat.request('/v1/responses?trace=1&provider=openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4',
        instructions: '🍐💩🐷，喜欢用很多 emoji 回复消息。',
        max_output_tokens: 2048,
        input: [{ role: 'user', content: 'what is 1+1?' }],
      }),
    })

    expect(res.status).toBe(200)

    const json: any = await res.json()

    expect(json.id).toMatch(/^resp_/)
    expect(json.object).toBe('response')
    expect(json.status).toBe('completed')
    expect(json.model).toBe('gpt-5.4')
    expect(json.instructions).toContain('emoji')
    expect(json.max_output_tokens).toBe(2048)
    expect(json.output).toHaveLength(1)
    expect(json.output[0].type).toBe('message')
    expect(json.output[0].role).toBe('assistant')
    expect(json.output[0].phase).toBe('final_answer')
    expect(json.output[0].content[0].type).toBe('output_text')
    expect(json.output[0].content[0].text).toBeTypeOf('string')
    expect(json.output[0].content[0].text.length).toBeGreaterThan(0)
    expect(json.output[0].content[0].text).toContain('POST /v1/responses?trace=1&provider=openai model=gpt-5.4')
    expect(json.text.format.type).toBe('text')
    expect(json.usage.total_tokens).toBeGreaterThan(0)
  })

  it('returns the same OpenAI-style error envelope for the sentinel model', async () => {
    const res = await chat.request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'error-test',
        input: [{ role: 'user', content: 'Hello' }],
      }),
    })

    expect(res.status).toBe(404)
    expect(res.headers.get('x-request-id')).toMatch(/^req_/)

    const json: any = await res.json()

    expect(json.error).toEqual({
      message: 'The model `error-test` does not exist or you do not have access to it.',
      type: 'invalid_request_error',
      param: null,
      code: 'model_not_found',
    })
  })
})

describe('POST /v1beta/models/:model:generateContent', () => {
  it('returns a Gemini generateContent payload', async () => {
    const res = await chat.request('/v1beta/models/gemini-3-flash-preview:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          role: 'user',
          parts: [{ text: '🍐💩🐷，喜欢用很多 emoji 回复消息。' }],
        },
        generationConfig: { maxOutputTokens: 2048 },
        contents: [{ parts: [{ text: 'what is 1+1?' }] }],
      }),
    })

    expect(res.status).toBe(200)

    const json: any = await res.json()

    expect(json.candidates).toHaveLength(1)
    expect(json.candidates[0].content.role).toBe('model')
    expect(json.candidates[0].content.parts[0].text).toBeTypeOf('string')
    expect(json.candidates[0].content.parts[0].text.length).toBeGreaterThan(0)
    expect(json.candidates[0].content.parts[0].text).toContain('POST /v1beta/models/gemini-3-flash-preview:generateContent model=gemini-3-flash-preview')
    expect(json.candidates[0].finishReason).toBe('STOP')
    expect(json.modelVersion).toBe('gemini-3-flash-preview')
    expect(json.responseId).toBeTypeOf('string')
    expect(json.createTime).toBeTypeOf('string')
    expect(json.usageMetadata.promptTokenCount).toBeGreaterThan(0)
    expect(json.usageMetadata.totalTokenCount).toBeGreaterThan(0)
  })

  it('returns a Google-style error envelope for the sentinel model', async () => {
    const res = await chat.request('/v1beta/models/error-test:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Hello' }] }],
      }),
    })

    expect(res.status).toBe(400)

    const json: any = await res.json()

    expect(json.error.code).toBe(400)
    expect(json.error.status).toBe('INVALID_ARGUMENT')
    expect(json.error.message).toContain('models/error-test')
    expect(json.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'MODEL_NOT_SUPPORTED',
          domain: 'generativelanguage.googleapis.com',
          metadata: {
            model: 'models/error-test',
            method: 'generateContent',
          },
        }),
        expect.objectContaining({
          '@type': 'type.googleapis.com/google.rpc.Help',
        }),
      ]),
    )
  })
})

describe('POST /v1/messages', () => {
  it('returns an Anthropic Messages API payload', async () => {
    const res = await chat.request('/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'gemini-3-flash-preview',
        system: '🍐💩🐷，喜欢用很多 emoji 回复消息。',
        max_tokens: 2048,
        messages: [{ role: 'user', content: 'what is 1+1?' }],
      }),
    })

    expect(res.status).toBe(200)

    const json: any = await res.json()

    expect(json.id).toMatch(/^msg_/)
    expect(json.type).toBe('message')
    expect(json.role).toBe('assistant')
    expect(json.model).toBe('gemini-3-flash-preview')
    expect(json.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.any(String),
      }),
    ])
    expect(json.content[0].text.length).toBeGreaterThan(0)
    expect(json.content[0].text).toContain('POST /v1/messages model=gemini-3-flash-preview')
    expect(json.stop_reason).toBe('end_turn')
    expect(json.stop_sequence).toBeNull()
    expect(json.usage.input_tokens).toBeGreaterThan(0)
    expect(json.usage.output_tokens).toBeGreaterThan(0)
    expect(json.usage.cache_creation_input_tokens).toBe(0)
    expect(json.usage.cache_read_input_tokens).toBe(0)
  })

  it('returns an Anthropic-style error envelope for the sentinel model', async () => {
    const res = await chat.request('/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'error-test',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    })

    expect(res.status).toBe(400)
    expect(res.headers.get('request-id')).toMatch(/^req_/)

    const json: any = await res.json()

    expect(json.type).toBe('error')
    expect(json.error).toEqual({
      type: 'invalid_request_error',
      message: 'Unsupported model: error-test. See the models documentation for valid model IDs.',
    })
    expect(json.request_id).toMatch(/^req_/)
  })
})
