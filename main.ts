// Early-snipe bot for the pump.fun replay sprint, tuned iteration.
//
// Idea (fresh design, different from established-coin momentum): brand-new
// bonding curves spend their first few trades discovering a price. The
// explosive ones (+35% in a few trades) are usually already topping when
// a fill lands 2 slots later, so this bot buys only the QUIET risers:
// coins on their 2nd-10th trade whose price sits just +2% to +12% above
// the first trade's price, with the latest trade a buy of at least 1 SOL
// (real buy-side demand, not a drift-up on dust). It then exits fast:
// take profit at +8% over all-in cost, stop out at -8%, or dump after
// 10 more trades, whichever comes first. One shot per coin, at most 5
// open positions, size capped at 0.08 SOL and at 1% of real reserves
// (never below 0.01 SOL, so every round trip counts toward the
// 20-mint guardrail).
//
// All comparisons are exact bigint cross-multiplications on the virtual
// reserves, so the bot is fully deterministic: no clock, no randomness,
// iteration only in first-seen Map order.

import { runBot } from './vendor/makefun-bot.ts';

const WANT_LAMPORTS = 80_000_000n; // 0.08 SOL target buy
const MIN_BUY_LAMPORTS = 10_000_000n; // 0.01 SOL, the round-trip floor
const MIN_TRIGGER_SOL_LAMPORTS = 1_000_000_000n; // latest trade >= 1 SOL
const MIN_REAL_SOL_LAMPORTS = 1_000_000_000n; // real reserves >= 1 SOL
const BUY_SLIPPAGE_BPS = 1000; // do not chase a pump that ran >10% in 2 slots
const SELL_SLIPPAGE_BPS = 10000; // always get out
const TP_NUM = 108n;
const TP_DEN = 100n;
const SL_NUM = 92n;
const SL_DEN = 100n;
const MOM_NUM = 102n;
const MOM_DEN = 100n;
const MOM_MAX_NUM = 112n;
const MOM_MAX_DEN = 100n;
const TIMEOUT_TRADES = 10;
const MAX_POSITIONS = 5;
const MAX_BUYS_PER_BATCH = 5;

interface CoinNote {
  firstVq: bigint;
  firstVt: bigint;
  lastIsBuy: boolean;
  lastSolLamports: bigint;
}

interface HeldNote {
  entryCostLamports: bigint;
  entryTokens: bigint;
  tradesHeld: number;
}

const notes = new Map<string, CoinNote>();
const held = new Map<string, HeldNote>();
const attempted = new Set<string>();

await runBot({
  onBatch(state, batch) {
    const orders: Array<
      | { side: 'buy'; mint: string; quote_lamports: bigint; max_slippage_bps: number }
      | { side: 'sell'; mint: string; token_amount: bigint; max_slippage_bps: number }
    > = [];

    // Observe this batch's trades: remember each coin's first-trade price
    // and its latest trade, and count trades while we hold a position.
    for (const e of batch.events) {
      if (e.event !== 'TradeEvent') continue;
      const note = notes.get(e.mint);
      if (note === undefined) {
        notes.set(e.mint, {
          firstVq: BigInt(e.virtual_quote_reserves),
          firstVt: BigInt(e.virtual_token_reserves),
          lastIsBuy: e.is_buy,
          lastSolLamports: BigInt(e.sol_amount),
        });
      } else {
        note.lastIsBuy = e.is_buy;
        note.lastSolLamports = BigInt(e.sol_amount);
      }
      const h = held.get(e.mint);
      if (h !== undefined) h.tradesHeld += 1;
    }

    // Sync held positions with the account (fills may have landed).
    for (const [mint, p] of state.positions) {
      if (!held.has(mint)) {
        held.set(mint, {
          entryCostLamports: BigInt(p.cost_lamports),
          entryTokens: BigInt(p.token_amount),
          tradesHeld: 0,
        });
      }
    }
    for (const mint of [...held.keys()]) {
      if (!state.positions.has(mint)) held.delete(mint);
    }

    // Mints with a sell already in flight: do not send a duplicate sell.
    const sellPending = new Set<string>();
    for (const pending of state.pending.values()) {
      if (pending.order.side === 'sell') sellPending.add(pending.order.mint);
    }

    // Exits: take profit +8%, stop loss -8%, or 10-trade timeout.
    for (const [mint, h] of held) {
      if (sellPending.has(mint)) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const pos = state.positions.get(mint);
      if (pos === undefined) continue;
      const vq = curve.virtual_quote_reserves;
      const vt = curve.virtual_token_reserves;
      // price >= TP * entry  <=>  vq * tokens * 100 >= 108 * cost * vt
      const tpHit = vq * h.entryTokens * TP_DEN >= TP_NUM * h.entryCostLamports * vt;
      // price <= SL * entry  <=>  vq * tokens * 100 <= 92 * cost * vt
      const slHit = vq * h.entryTokens * SL_DEN <= SL_NUM * h.entryCostLamports * vt;
      if (tpHit || slHit || h.tradesHeld >= TIMEOUT_TRADES) {
        orders.push({
          side: 'sell',
          mint,
          token_amount: BigInt(pos.token_amount),
          max_slippage_bps: SELL_SLIPPAGE_BPS,
        });
      }
    }

    // Entries: one early snipe per fresh coin.
    const txFee = state.txFeeLamports();
    let freeCash = state.freeCashLamports();
    let buysPlanned = 0;
    for (const [mint, curve] of state.curves) {
      if (orders.length >= 16) break;
      if (buysPlanned >= MAX_BUYS_PER_BATCH) break;
      if (state.committedPositionCount() + buysPlanned >= MAX_POSITIONS) break;
      if (curve.complete) continue;
      if (curve.trades < 2 || curve.trades > 10) continue;
      if (attempted.has(mint) || held.has(mint) || state.positions.has(mint)) continue;
      const note = notes.get(mint);
      if (note === undefined) continue;
      if (!note.lastIsBuy) continue;
      if (note.lastSolLamports < MIN_TRIGGER_SOL_LAMPORTS) continue;
      if (curve.real_quote_reserves < MIN_REAL_SOL_LAMPORTS) continue;
      // Quiet-riser window: current price between +2% and +12% of the
      // first trade's price. vq/vt >= 102/100 * firstVq/firstVt, <= 112/100.
      if (curve.virtual_quote_reserves * note.firstVt * MOM_DEN < MOM_NUM * note.firstVq * curve.virtual_token_reserves) continue;
      if (curve.virtual_quote_reserves * note.firstVt * MOM_MAX_DEN > MOM_MAX_NUM * note.firstVq * curve.virtual_token_reserves) continue;
      const cap = state.maxBuyLamports(mint);
      const size = cap < WANT_LAMPORTS ? cap : WANT_LAMPORTS;
      if (size < MIN_BUY_LAMPORTS) continue;
      if (freeCash < size + txFee) continue;
      attempted.add(mint);
      buysPlanned += 1;
      freeCash -= size + txFee;
      orders.push({ side: 'buy', mint, quote_lamports: size, max_slippage_bps: BUY_SLIPPAGE_BPS });
    }

    return orders;
  },
});
