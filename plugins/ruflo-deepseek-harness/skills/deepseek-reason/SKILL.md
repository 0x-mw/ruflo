---
name: deepseek-reason
description: "/v1/chat/completions로 DeepSeek의 `deepseek-reasoner` 모델(R1)에 추론 모드 완성을 요청합니다. 모델의 사고 연쇄(`reasoning_content`)를 최종 답(`content`)과 분리해 제공하므로, 호출자가 다시 파싱하지 않고도 사고 연쇄를 표시하거나 버릴 수 있습니다. DEEPSEEK_API_KEY를 읽으며, 설정되지 않았거나 API에 접근할 수 없으면 status:degraded 엔벨로프와 함께 exit 0으로 단계적으로 축소됩니다. DeepSeek 명세에 따라 reasoner 모델의 temperature/top_p는 무시합니다."
argument-hint: "--prompt <text> [--system <text>] [--model deepseek-reasoner] [--max-tokens 4096] [--show-reasoning] [--format table|json] [--alert-on-error]"
allowed-tools: Bash
---

Wraps DeepSeek's reasoning model so ruflo callers can get an explicit
chain-of-thought back with the final answer, without having to parse it
out of the message content. Same subprocess-invocation shape as the sibling
`deepseek-chat` skill.

## When to use

- Multi-step reasoning tasks: proofs, plans, root-cause analysis, hard
  bug triage.
- You want to *see* the model's thinking (for audit, for training data,
  or to sanity-check its final answer).
- You can tolerate the higher latency and token cost of a reasoner vs
  `deepseek-chat`.

## Algorithm

Implementation: [`scripts/reason.mjs`](../../scripts/reason.mjs).

1. Read `DEEPSEEK_API_KEY` from env. Degrade gracefully when missing.
2. POST to `/v1/chat/completions` with `{ model: 'deepseek-reasoner', messages, max_tokens? }`.
   Per DeepSeek's docs, `temperature`/`top_p` are ignored for reasoner
   models — this script does not forward them.
3. Extract `choices[0].message.content` AND `choices[0].message.reasoning_content`.
4. JSON output always includes `reasoning`; table mode omits it unless
   `--show-reasoning` is passed.
5. `reasoningTokens` (from `usage.completion_tokens_details.reasoning_tokens`)
   is surfaced separately so callers can attribute cost.

## Example

```bash
node plugins/ruflo-deepseek-harness/scripts/reason.mjs \
  --prompt "Prove that sqrt(2) is irrational." \
  --format table --show-reasoning
```

Table output shows the reasoning block, then the answer. JSON mode returns:

```json
{
  "status": "ok",
  "model": "deepseek-reasoner",
  "content": "sqrt(2) is irrational because …",
  "reasoning": "Assume for contradiction that sqrt(2) = p/q in lowest terms …",
  "finishReason": "stop",
  "usage": {
    "promptTokens": 14,
    "completionTokens": 812,
    "reasoningTokens": 640,
    "totalTokens": 826
  }
}
```
