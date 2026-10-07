---
name: cost-local
description: 소유한 하드웨어(Ollama, llama.cpp, vLLM, LM Studio)의 백만 토큰당 비용을 전력(W), 전기 요금, 하드웨어 가격, 실측 토큰/초로 계산하고, 로컬이 호스팅 모델보다 유리해지는 활용률을 구합니다. 로컬 대 API 손익분기 질문에 사용합니다.
argument-hint: "--tok-per-s <n> [--busy 0.25] [--compare <model>] [--format json|markdown]"
allowed-tools: Bash
---

# Cost Local

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/local-cost.mjs --tok-per-s 80 --busy 0.25 --compare claude-haiku-4-5
```

Inputs (all the user's): `--watts-idle`, `--watts-active`, `--kwh`, `--hw-price`, `--life-years`, `--resale`. `--tok-per-s` is required and must be a **measured** generation speed.

## Rules

- Cost = **fixed** (amortisation + idle power, paid busy or not) + **marginal** (extra watts while generating). Utilisation decides the answer: always show the table at 5/25/50/100% busy.
- It is an estimate from the inputs; say so. Nothing is measured.
- Compare against a same-capability hosted model, not a frontier one; price alone is a poor reason to buy a GPU for sporadic use.
- Read real counts from the server (Ollama `eval_count`/`prompt_eval_count` on the native API, llama.cpp `timings`, vLLM `/metrics`), not the lossy OpenAI-compatible `usage`, and count model reloads (`load_duration`) as overhead.
