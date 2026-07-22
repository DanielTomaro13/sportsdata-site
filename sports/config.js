// sportsdata-ai.com/sports is a STATIC page — it renders a captured snapshot of
// real market data (sharp line, industry ladders, money-flow, the SGM price
// generator). Point it at a live warehouse-backed board by deploying the
// sportsboard backend and opening …/sports/?api=https://your-host
window.SB_CONFIG = { forceReplay: true, replayUrl: "data/replay.json", apiBase: null };
