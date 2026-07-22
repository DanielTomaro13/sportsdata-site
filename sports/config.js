// STATIC sports board — animates a captured sequence of real market data.
// Make it LIVE by deploying the warehouse-backed board (see deploy/serve_live.sh
// for the free path, or deploy/render.yaml) and opening the page with
//   …/sports/?api=https://your-host
window.SB_CONFIG = { forceReplay: true, replayUrl: "data/replay.json", apiBase: null };
