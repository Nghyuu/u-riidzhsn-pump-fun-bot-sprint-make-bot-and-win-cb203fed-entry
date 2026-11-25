# Quiet-Riser Snipe — Pump.fun Replay Sprint

[![bounty](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/Nghyuu/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed-entry/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/Nghyuu/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed-entry/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A paper-trading bot for the pump.fun replay sprint. It buys brand-new
bonding curves only when they rise quietly (+2% to +12% over the first
trade's price on their 2nd–10th trade, latest trade a buy of at least
1 SOL), then exits fast: +8% take-profit, −8% stop-loss, or a 10-trade
timeout. One shot per coin, at most 5 open positions, 0.08 SOL per buy
capped at 1% of real reserves. Fully deterministic (bigint price
comparisons, no clock, no randomness).

## Files

- `main.ts` — the bot (Node 22, TypeScript, Node stdlib only)
- `vendor/makefun-bot.ts` — the agent-fun/replay/v2 shim

## License

MIT — see `LICENSE`.
