# Subway Builder – Developer Handover Roadmap (v2)

## 0. Project Vision

Subway Builder is a hyper-realistic subway simulation and city-planning game. Players design, build, and operate subway networks under real-world constraints, watching millions of simulated commuters respond in real time.

## 1. Core Objectives

| Area | Goal |
| --- | --- |
| Map Engine | Real-time, high-performance 2D/3D visualization of networks and commuters |
| Simulation | Physics-lite but data-credible train + passenger system |
| Economics | True costs, fare revenue, and disruption impact |
| UI/UX | Clean Apple-grade minimalism—no gradients, emoji icons only |
| Data | Real GTFS + Census/FAA/IPEDS for demand synthesis |
| Security | No embedded API keys; user-supplied configuration |
| Performance | ≥ 60 FPS UI / ≤ 30 % CPU on M-series laptop |

## 2. Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend Framework | SvelteKit (TypeScript + Vite + Tailwind + Framer Motion) |
| Map Renderer | Mapbox GL JS v3 (user-supplied token & style) |
| Simulation Engine | Web Worker (+ optional WASM module later) |
| Storage | localStorage / IndexedDB for user config + saves |
| Build/Deploy | Vite → Cloudflare Pages or Netlify |
| Charts | D3 or Plotly for HUD analytics |

## 3. Repository Layout

```
/app
  /public
    /styles/map-style.json
    /data/*                # starter GTFS + demand JSONs
  /src
    main.ts
    map/
      map.ts
      layers/
    sim/
      worker.ts
      core.ts
      graph.ts
      demand.ts
    ui/
      panels/
      hud/
    lib/
      config.ts
      gtfs/
  /docs/
    dev-guidelines.md
    visual-guidelines.md
    handover-roadmap.md
```

## 4. Immediate Priorities (First 2 Weeks)

1. **Code Audit**
   - Remove all broken legacy modules from previous dev.
   - Check for hard-coded API keys or endpoints → delete.
  - Validate map renders using a local style JSON fallback (no remote links).
2. **Stabilize Map Renderer**
  - Mapbox GL JS wired to localStorage credentials with OSM raster fallback.
  - Verify CORS-safe tile source loads correctly.
3. **UI Shell**
   - Left panel = Construction / Cost.
   - Right panel = Map Layers.
   - Bottom HUD = budget + trains + time + play/pause.
   - Use emojis ⚙️ 🚇 📊 💰 🧭 for icons.
   - Strictly follow `visual-guidelines.md` (flat colors, no gradients).
4. **Worker Bridge**
   - Set up `worker.ts` ↔ main thread messaging.
   - One tick = 1 s sim time; UI update = 1 Hz.

**Deliverable:** Stable Phase 1 prototype with editable lines and station placement.

## 5. Phase Roadmap (Execution Plan)

- **Phase 0 – Bootstrap**
  - ✔ Set up project, lint, formatting, build scripts.
  - ✔ No API keys in code.
  - ✔ Working map container.
- **Phase 1 – Map + Editor**
  - Implement drawing tool for tracks/stations.
  - Cost overlay by construction method (TBM, cut-and-cover, viaduct).
  - Save/load `lines.json` + `stations.json`.
  - UI animations ≤ 200 ms.
- **Phase 2 – Simulation Skeleton**
  - Trains spawn per headway; Euler motion.
  - Dwell logic = base + α × board + β × alight.
  - Headway enforcement.
  - KPI HUD (cars, avg headway, on-time %).
- **Phase 3 – Demand & Routing**
  - Gravity model + synthetic OD table.
  - Multinomial Logit mode choice.
  - RAPTOR pathfinding for transit.
  - Boarding queues + load factor.
- **Phase 4 – Economics & Incidents**
  - Cost & revenue model per km/station.
  - Random incidents (Poisson process) → delay ripple.
  - Display budget Δ + cashflow charts.
- **Phase 5 – Analytics & Planner**
  - Journey planner UI (origin/dest/time).
  - Histograms of arrivals/departures.
  - Demand heat layer + station ridership table.
- **Phase 6 – Visual Polish & Optimization**
  - Apply final color scheme (Piano Black / Old Money Green / Gold).
  - Canvas layer for > 1 k particles.
  - Add micro-sound 🎧 for train departures.
  - Optimize map updates ≤ 60 msg/s.
- **Phase 7 – Deploy & Docs**
  - Service Worker caching.
  - Scenario export/import (JSON).
  - Public build to Cloudflare Pages.
  - Update docs and release tag v1.0.

## 6. Simulation Reference (For `core.ts`)

**Train Dynamics**

```
v = clamp(v + a * dt, 0, vmax)
x = x + v * dt
if near(station) → dwell()
```

**Dwell Time**

```
dwell = base + α * board + β * alight
```

**Mode Choice**

```
P_m = e^{U_m} / Σ e^{U_k},   where   U_m = -α_t T_m - α_c C_m + α_v V
```

**Gravity Model**

```
P_ij ∝ (Pop_i × Jobs_j) / Dist_ij^β
```

## 7. Developer Rules (Non-negotiable)

- 🚫 No gradients, drop-shadows, or animated backgrounds.
- 🚫 Do not rename model strings (`Train`, `Station`, `Edge` …).
- 🚫 No external API keys hard-coded.
- ✅ Use emojis for icons.
- ✅ Store all config (client-side only).
- ✅ Follow 8-px grid and SF Pro fonts.
- ✅ UI motion ≤ 200 ms ease-in-out.
- ✅ Code comments concise and typed (JS Doc for exports only).

## 8. Performance Targets

| Metric | Target |
| --- | --- |
| Frame rate | ≥ 60 FPS UI |
| CPU load | ≤ 30 % on M2 |
| Active trains | 50–80 simultaneously |
| Passengers per tick | 100 k/day ≈ 1 Hz updates |
| File size (bundle) | < 10 MB gzipped |

## 9. Testing & CI

- Unit tests for simulation and UI helpers (Jest + Vitest).
- E2E: Cypress for map interaction.
- Lint / Prettier enforced pre-commit.
- Branch naming: `feat/`, `fix/`, `ui/`, `sim/`, `data/`.

## 10. Deployment Checklist

1. Run `npm run build`.
2. Serve via `npx serve dist` → verify tiles load.
3. Push to `main` branch → CI auto-deploy.
4. Validate CORS for tiles.
5. Tag release `v1.0` once QA passes.

## 11. Future Extensions (Post-v1)

- Multiplayer planner mode (Socket.io).
- Weather / climate impact on demand.
- Real city import (GTFS drag-drop).
- Mobile companion dashboard.

---

✅ **Handoff Summary:** Deliverable: A clean rebuild following the Phase 0-7 roadmap. All API keys removed. User configurable tiles. Flat visual style. Simulation validated with realistic commuter behavior.
