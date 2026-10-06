---
name: trader-regime
description: npx neural-trader로 현재 시장 국면을 탐지합니다 — 추천 전략과 함께 강세/약세/횡보/변동성(bull/bear/ranging/volatile) 분류. 사용자가 시장 상황을 묻거나, 현재 상황에 맞는 전략을 고르려 하거나, 국면을 인식해야 하는 백테스트/시그널을 실행하기 전에 사용합니다.
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__neural_predict
argument-hint: "[--symbol SPY] [--symbols AAPL,MSFT]"
---
Detect the current market regime using neural-trader's regime detection engine.

Steps:
1. Ensure neural-trader is available:
   `npm ls neural-trader 2>/dev/null || npm install --ignore-scripts neural-trader`
2. Run regime detection:
   ```bash
   npx neural-trader --regime-detect --symbol TICKER
   ```
   For multiple symbols:
   ```bash
   npx neural-trader --regime-detect --symbols "AAPL,MSFT,GOOGL,AMZN"
   ```
3. Get technical indicators for context:
   ```bash
   npx neural-trader --symbol TICKER --indicators rsi,macd,bollinger,adx,atr
   ```
4. Use SONA for regime prediction:
   `mcp__plugin_ruflo-core_ruflo__neural_predict({ input: "indicators: RSI=X, ADX=Y, VIX=Z" })`
5. Search for similar historical regimes:
   `mcp__plugin_ruflo-core_ruflo__memory_search({ query: "regime similar to CURRENT", namespace: "trading-analysis" })`
6. Present: regime classification, confidence, recommended strategy type, historical precedents
7. Store analysis:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "regime-DATE", value: "REGIME_ANALYSIS", namespace: "trading-analysis" })`
