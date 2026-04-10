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
        expect.objectContaining({ id: 'gpt-5.4-incomplete-test', object: 'model', owned_by: 'openai' }),
        expect.objectContaining({ id: 'error-test', object: 'model', owned_by: 'openai' }),
        expect.objectContaining({ id: 'gemini-3-flash-preview', object: 'model', owned_by: 'google' }),
        expect.objectContaining({ id: 'claude-sonnet-4-6', object: 'model', owned_by: 'anthropic' }),
      ]),
    )
  })
})

describe('GET /v1beta/models', () => {
  it('returns a Gemini-native model list', async () => {
    const res = await chat.request('/v1beta/models')
    expect(res.status).toBe(200)

    const json: any = await res.json()

    expect(json.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'models/gemini-3-flash-preview',
          version: 'preview',
          displayName: 'Gemini 3 Flash Preview',
          supportedGenerationMethods: expect.arrayContaining(['generateContent']),
        }),
        expect.objectContaining({
          name: 'models/gemini-3-pro-preview',
          version: 'preview',
          displayName: 'Gemini 3 Pro Preview',
          supportedGenerationMethods: expect.arrayContaining(['generateContent']),
        }),
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
    expect(json.model).toBe('gpt-5.4-2026-03-17')
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

  it('streams Responses API events when stream=true', async () => {
    const res = await chat.request('/v1/responses?trace=1&provider=openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        stream: true,
        instructions: '喜欢用很多 emoji 回复消息。',
        reasoning: { effort: 'low' },
        input: [{ role: 'user', content: '请用中文告诉我：what is 1+1，what is your model?' }],
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await res.text()
    const chunks = text
      .trim()
      .split('\n\n')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const event = chunk.match(/^event: (.+)$/m)?.[1]
        const dataText = chunk.match(/^data: (.+)$/m)?.[1]

        return {
          event,
          data: dataText ? JSON.parse(dataText) : null,
        }
      })

    expect(chunks.length).toBeGreaterThan(6)
    expect(chunks[0].event).toBe('response.created')
    expect(chunks[0].data?.type).toBe('response.created')
    expect(chunks[0].data?.sequence_number).toBe(0)
    expect(chunks[0].data?.response.id).toMatch(/^resp_/)
    expect(chunks[0].data?.response.object).toBe('response')
    expect(chunks[0].data?.response.created_at).toBeTypeOf('number')
    expect(chunks[0].data?.response.status).toBe('in_progress')
    expect(chunks[0].data?.response.background).toBe(false)
    expect(chunks[0].data?.response.completed_at).toBeNull()
    expect(chunks[0].data?.response.error).toBeNull()
    expect(chunks[0].data?.response.frequency_penalty).toBe(0)
    expect(chunks[0].data?.response.incomplete_details).toBeNull()
    expect(chunks[0].data?.response.instructions).toContain('emoji')
    expect(chunks[0].data?.response.max_output_tokens).toBeNull()
    expect(chunks[0].data?.response.max_tool_calls).toBeNull()
    expect(chunks[0].data?.response.model).toBe('gpt-5.4-mini-2026-03-17')
    expect(chunks[0].data?.response.output).toEqual([])
    expect(chunks[0].data?.response.parallel_tool_calls).toBe(true)
    expect(chunks[0].data?.response.presence_penalty).toBe(0)
    expect(chunks[0].data?.response.previous_response_id).toBeNull()
    expect(chunks[0].data?.response.prompt_cache_key).toMatch(/^cache_/)
    expect(chunks[0].data?.response.prompt_cache_retention).toBeNull()
    expect(chunks[0].data?.response.reasoning).toEqual({ effort: 'low', summary: null })
    expect(chunks[0].data?.response.safety_identifier).toBeNull()
    expect(chunks[0].data?.response.service_tier).toBe('default')
    expect(chunks[0].data?.response.store).toBe(false)
    expect(chunks[0].data?.response.temperature).toBe(1)
    expect(chunks[0].data?.response.text).toEqual({ format: { type: 'text' }, verbosity: 'medium' })
    expect(chunks[0].data?.response.tool_choice).toBe('auto')
    expect(chunks[0].data?.response.tool_usage).toEqual({
      image_gen: {
        input_tokens: 0,
        input_tokens_details: { image_tokens: 0, text_tokens: 0 },
        output_tokens: 0,
        output_tokens_details: { image_tokens: 0, text_tokens: 0 },
        total_tokens: 0,
      },
      web_search: { num_requests: 0 },
    })
    expect(chunks[0].data?.response.tools).toEqual([])
    expect(chunks[0].data?.response.top_logprobs).toBe(0)
    expect(chunks[0].data?.response.top_p).toBe(1)
    expect(chunks[0].data?.response.truncation).toBe('disabled')
    expect(chunks[0].data?.response.usage).toBeNull()
    expect(chunks[0].data?.response.user).toBeNull()
    expect(chunks[0].data?.response.metadata).toEqual({})
    expect(chunks[1].event).toBe('response.in_progress')
    expect(chunks[1].data?.type).toBe('response.in_progress')
    expect(chunks[1].data?.response.status).toBe('in_progress')

    const outputItemAddedEvents = chunks.filter((chunk) => chunk.event === 'response.output_item.added')
    expect(outputItemAddedEvents).toHaveLength(2)

    const reasoningItemAdded = outputItemAddedEvents[0]
    expect(reasoningItemAdded?.data?.output_index).toBe(0)
    expect(reasoningItemAdded?.data?.item.id).toMatch(/^rs_/)
    expect(reasoningItemAdded?.data?.item.type).toBe('reasoning')
    expect(reasoningItemAdded?.data?.item.encrypted_content).toMatch(/^gAAAAA/)
    expect(reasoningItemAdded?.data?.item.summary).toEqual([])

    const reasoningItemDone = chunks.find(
      (chunk) => chunk.event === 'response.output_item.done' && chunk.data?.item?.type === 'reasoning',
    )
    expect(reasoningItemDone?.data?.output_index).toBe(0)
    expect(reasoningItemDone?.data?.item).toEqual(reasoningItemAdded?.data?.item)

    const outputItemAdded = outputItemAddedEvents[1]
    expect(outputItemAdded?.data?.item.type).toBe('message')
    expect(outputItemAdded?.data?.item.id).toMatch(/^msg_/)
    expect(outputItemAdded?.data?.item.status).toBe('in_progress')
    expect(outputItemAdded?.data?.item.content).toEqual([])
    expect(outputItemAdded?.data?.item.phase).toBe('final_answer')
    expect(outputItemAdded?.data?.item.role).toBe('assistant')
    expect(outputItemAdded?.data?.output_index).toBe(1)

    const contentPartAdded = chunks.find((chunk) => chunk.event === 'response.content_part.added')
    expect(contentPartAdded?.data?.content_index).toBe(0)
    expect(contentPartAdded?.data?.item_id).toBe(outputItemAdded?.data?.item.id)
    expect(contentPartAdded?.data?.output_index).toBe(1)
    expect(contentPartAdded?.data?.part).toEqual({
      type: 'output_text',
      annotations: [],
      logprobs: [],
      text: '',
    })

    const deltaEvents = chunks.filter((chunk) => chunk.event === 'response.output_text.delta')
    expect(deltaEvents.length).toBeGreaterThan(0)
    expect(deltaEvents[0]?.data?.content_index).toBe(0)
    expect(deltaEvents[0]?.data?.item_id).toBe(outputItemAdded?.data?.item.id)
    expect(deltaEvents[0]?.data?.output_index).toBe(1)
    expect(deltaEvents[0]?.data?.logprobs).toEqual([])
    expect(deltaEvents[0]?.data?.obfuscation).toBeTypeOf('string')
    expect(deltaEvents[0]?.data?.obfuscation.length).toBeGreaterThan(0)

    const streamedText = deltaEvents.map((chunk) => chunk.data?.delta ?? '').join('')
    expect(streamedText).toContain('POST /v1/responses?trace=1&provider=openai model=gpt-5.4-mini')

    const doneEvent = chunks.find((chunk) => chunk.event === 'response.output_text.done')
    expect(doneEvent?.data?.content_index).toBe(0)
    expect(doneEvent?.data?.item_id).toBe(outputItemAdded?.data?.item.id)
    expect(doneEvent?.data?.output_index).toBe(1)
    expect(doneEvent?.data?.logprobs).toEqual([])
    expect(doneEvent?.data?.text).toContain('POST /v1/responses?trace=1&provider=openai model=gpt-5.4-mini')

    const contentPartDone = chunks.find((chunk) => chunk.event === 'response.content_part.done')
    expect(contentPartDone?.data?.content_index).toBe(0)
    expect(contentPartDone?.data?.item_id).toBe(outputItemAdded?.data?.item.id)
    expect(contentPartDone?.data?.output_index).toBe(1)
    expect(contentPartDone?.data?.part).toEqual({
      type: 'output_text',
      annotations: [],
      logprobs: [],
      text: doneEvent?.data?.text,
    })

    const outputItemDone = chunks.find(
      (chunk) => chunk.event === 'response.output_item.done' && chunk.data?.item?.type === 'message',
    )
    expect(outputItemDone?.data?.output_index).toBe(1)
    expect(outputItemDone?.data?.item).toEqual({
      id: outputItemAdded?.data?.item.id,
      type: 'message',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          annotations: [],
          logprobs: [],
          text: doneEvent?.data?.text,
        },
      ],
      phase: 'final_answer',
      role: 'assistant',
    })

    const completedEvent = chunks.at(-1)
    expect(completedEvent?.event).toBe('response.completed')
    expect(completedEvent?.data?.type).toBe('response.completed')
    expect(completedEvent?.data?.response.object).toBe('response')
    expect(completedEvent?.data?.response.status).toBe('completed')
    expect(completedEvent?.data?.response.model).toBe('gpt-5.4-mini-2026-03-17')
    expect(completedEvent?.data?.response.output).toEqual([reasoningItemAdded?.data?.item, outputItemDone?.data?.item])
    expect(completedEvent?.data?.response.usage.input_tokens).toBeGreaterThan(0)
    expect(completedEvent?.data?.response.usage.output_tokens).toBeGreaterThan(0)
    expect(completedEvent?.data?.response.usage.output_tokens_details.reasoning_tokens).toBeGreaterThan(0)
    expect(completedEvent?.data?.response.usage.total_tokens).toBe(
      completedEvent?.data?.response.usage.input_tokens + completedEvent?.data?.response.usage.output_tokens,
    )
    expect(completedEvent?.data?.response.output[1].content[0].text).toContain(
      'POST /v1/responses?trace=1&provider=openai model=gpt-5.4-mini',
    )
  })

  it('streams a failed Responses event sequence for the error-test model', async () => {
    const res = await chat.request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'error-test',
        stream: true,
        input: [{ role: 'user', content: 'Hello' }],
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await res.text()
    const chunks = text
      .trim()
      .split('\n\n')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const event = chunk.match(/^event: (.+)$/m)?.[1]
        const dataText = chunk.match(/^data: (.+)$/m)?.[1]

        return {
          event,
          data: dataText ? JSON.parse(dataText) : null,
        }
      })

    expect(chunks.map((chunk) => chunk.event)).toEqual(['response.created', 'response.in_progress', 'response.failed'])
    expect(chunks[0].data?.response.status).toBe('in_progress')
    expect(chunks[0].data?.response.error).toBeNull()
    expect(chunks[0].data?.response.usage).toBeNull()
    expect(chunks[2].data?.type).toBe('response.failed')
    expect(chunks[2].data?.response.status).toBe('failed')
    expect(chunks[2].data?.response.model).toBe('error-test')
    expect(chunks[2].data?.response.output).toEqual([])
    expect(chunks[2].data?.response.error).toEqual({
      code: 'server_error',
      message: 'Simulated stream failure for `error-test` model.',
    })
    expect(chunks[2].data?.response.usage.input_tokens).toBeGreaterThan(0)
    expect(chunks[2].data?.response.usage.output_tokens).toBe(0)
  })

  it('streams an incomplete Responses event sequence for the incomplete test model', async () => {
    const res = await chat.request('/v1/responses?trace=1&provider=openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4-incomplete-test',
        stream: true,
        input: [{ role: 'user', content: 'Hello' }],
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await res.text()
    const chunks = text
      .trim()
      .split('\n\n')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const event = chunk.match(/^event: (.+)$/m)?.[1]
        const dataText = chunk.match(/^data: (.+)$/m)?.[1]

        return {
          event,
          data: dataText ? JSON.parse(dataText) : null,
        }
      })

    expect(chunks[0].event).toBe('response.created')
    expect(chunks[1].event).toBe('response.in_progress')
    expect(chunks.at(-1)?.event).toBe('response.incomplete')
    expect(chunks.at(-1)?.data?.response.status).toBe('incomplete')
    expect(chunks.at(-1)?.data?.response.incomplete_details).toEqual({ reason: 'max_output_tokens' })
    expect(chunks.at(-1)?.data?.response.model).toBe('gpt-5.4-incomplete-test')

    const deltaEvents = chunks.filter((chunk) => chunk.event === 'response.output_text.delta')
    expect(deltaEvents.length).toBeGreaterThan(0)

    const streamedText = deltaEvents.map((chunk) => chunk.data?.delta ?? '').join('')
    expect(streamedText.length).toBeGreaterThan(0)

    const doneEvent = chunks.find((chunk) => chunk.event === 'response.output_text.done')
    expect(doneEvent?.data?.text).toBe(streamedText)

    const finalResponseText = chunks.at(-1)?.data?.response.output[0].content[0].text
    expect(finalResponseText).toBe(streamedText)
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
