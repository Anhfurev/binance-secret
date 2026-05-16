# Historical veto audit

Generated: 2026-05-16T08:00:10.742Z

## Summary

| Metric | Value |
| --- | ---: |
| Total rows loaded | 1000 |
| HOLD cycles | 986 |
| HOLD with AI ≥ 55% | 162 |
| HOLD with AI ≥ 65% | 22 |
| Blocked-buy setup candidates | 576 |
| Would convert (exact metrics) | 0 |
| Would convert (veto-inferred) | 573 |
| **Total simulated BUY** | **573** |

### Simulation parameters

- ADX sideways < 20, trend ≥ 22
- Sideways RSI entry max: 42
- Sideways AI floor: 52%
- Micro-cap volume scale: 35%

### Veto type counts (HOLD cycles)

| Blocker | Count |
| --- | ---: |
| FAIL_LOW_VOLUME_VS_24H_AVG | 889 |
| FAIL_EMA200 | 771 |
| NO_TRADE_FALLBACK | 662 |
| FAIL_LOW_1M_VOLUME_USD | 571 |
| FAIL_STRATEGY_NO_BUY | 504 |
| RSI_NOT_OVERSOLD | 504 |
| HOLD:hold_no_strategy_buy | 466 |
| HOLD:hold_technical_score_gate | 347 |
| FAIL_RSI_OVERSOLD | 56 |
| HOLD:strategy_buy_rejected_low_conviction | 52 |
| HOLD:strategy_buy_rejected_ai_call_failed | 39 |
| HOLD:aggressive_buy_rejected_low_tech | 38 |
| HOLD:hold_open_position | 34 |
| HOLD:hold_ai_action_not_buy | 9 |
| HOLD:Vetoed by Groq: fast_veto:5x1m_return_-0.8344%<-0.08 | 1 |

### High-confidence (≥55%) kills by blocker

| Blocker | Count |
| --- | ---: |
| FAIL_LOW_VOLUME_VS_24H_AVG | 157 |
| FAIL_EMA200 | 144 |
| FAIL_STRATEGY_NO_BUY | 91 |
| RSI_NOT_OVERSOLD | 91 |
| FAIL_LOW_1M_VOLUME_USD | 73 |
| FAIL_RSI_OVERSOLD | 30 |

### High-confidence (≥65%) kills by blocker

| Blocker | Count |
| --- | ---: |
| FAIL_EMA200 | 22 |
| FAIL_LOW_VOLUME_VS_24H_AVG | 21 |
| FAIL_RSI_OVERSOLD | 11 |
| FAIL_LOW_1M_VOLUME_USD | 2 |
| FAIL_STRATEGY_NO_BUY | 1 |
| RSI_NOT_OVERSOLD | 1 |
