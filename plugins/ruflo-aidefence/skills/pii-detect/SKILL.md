---
name: pii-detect
description: 텍스트, 코드, 설정에서 개인 식별 정보(PII)를 탐지하고 표시합니다. 이메일, 전화번호, SSN, API 키, 비밀번호가 들어 있을 수 있는 코드를 커밋하거나, 로그를 쓰거나, 데이터를 저장하거나, 모델 응답을 보내기 전에 사용합니다.
argument-hint: "<input-text>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__aidefence_has_pii mcp__plugin_ruflo-core_ruflo__aidefence_scan mcp__plugin_ruflo-core_ruflo__aidefence_analyze mcp__plugin_ruflo-core_ruflo__transfer_detect-pii Bash
---

# PII Detection

Detect personally identifiable information before it enters logs, commits, or responses.

## When to use

Before committing code, storing data, or sending responses that might contain PII (emails, phone numbers, SSNs, API keys, passwords).

## Steps

1. **Quick PII check** — call `mcp__plugin_ruflo-core_ruflo__aidefence_has_pii` with the text for a boolean result
2. **Detailed scan** — call `mcp__plugin_ruflo-core_ruflo__transfer_detect-pii` for categorized PII findings
3. **Full analysis** — call `mcp__plugin_ruflo-core_ruflo__aidefence_analyze` for context-aware PII detection
4. If PII found, flag the specific locations and suggest redaction

## PII categories detected

- Email addresses, phone numbers
- Social security numbers, tax IDs
- Credit card numbers
- API keys, tokens, passwords
- Physical addresses
- Names linked to sensitive data
