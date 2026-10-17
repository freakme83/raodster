# AIRSHIFT

**Dodge. Lift. Land. One more run.**

A complete mobile-first endless arcade driving prototype. Three lanes, one original cold-gas sports car, a sunset freeway, and distance as the only score. No accounts, assets to download, game engine, or runtime dependencies. The player car is an original **Kestrel-01**, with no Tesla branding or replicated vehicle design.

## Play locally

Requires Node.js 20 or newer. No `npm install` is necessary.

```sh
npm start
```

Open `http://localhost:4173`. For a phone on the same network, open `http://<your-computer-LAN-IP>:4173`. The development server listens on all interfaces; use it only on a trusted network. Serve the game over HTTP rather than opening `index.html` as a `file:` URL, because it uses ES modules.

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Move one lane | Tap left/right arrow, tap road edge, or swipe across road | ← / → or A / D |
| Launch / soften descent | Hold the lower-centre thrust pad | Hold Space, W, or ↑ |
| Cut thrust | Release | Release |
| Pause | Tap Ⅱ; also automatic on background/blur | Escape or P |
| Start / retry | Tap opening or results screen | Enter or Space |

Steering and thrust support simultaneous pointers. Sound can be toggled on the pause screen, and its preference is saved. Audio starts only after a user gesture.

**Learn in one run:** dodge the first car. Try a brief thrust hold in open road. Release to fall, then tap/hold again just before touchdown. An empty tank leaves you unable to brake your descent. Pressure recharges automatically when grounded and not thrusting.

## What's implemented

- Portrait-first responsive chase view, rendered as low-poly 3D geometry through Canvas 2D; capped device-pixel ratio.
- Three smooth lanes; gentler airborne steering and visible roll correction.
- Continuous thrust, launch suspension preload, altitude-dependent lift, descent braking, three pressure segments, and ground recharge.
- Deterministic landings based on roll and vertical speed; suspension compression, slip on rough landings, landing shadow, restrained camera response, and optional haptics.
- Six traffic shapes: compact, coupe, sedan, van, truck, and long truck.
- Bounded acceleration, irregular multi-row traffic, short relief windows, occasional peak attacks, shifting safe lanes, and protected low jump walls.
- Collision checks against full vehicle footprints and roof heights, road-edge failure, unsafe-angle and hard-impact crashes.
- Distance, persistent local best, perfect landing / close call / car-jump feedback, brief crash pose, immediate restart.
- Procedural road hum, gas hiss, tire movement, recharge, landing and crash audio, plus a quiet original electronic sequence.
- Pause on tab background or focus loss; cleared input on cancel/blur/retry; safe fallback when storage or audio is unavailable.
- Reduced-motion preference suppresses impact flashes, haptics, landing rings and camera impact motion.

## Build and host

```sh
npm test
npm run build
```

Upload the contents of `dist/` to any static host. All asset paths are relative, so hosting in a subdirectory works. `netlify.toml` supplies the build and output settings for a connected Netlify deployment. No hosting service is provisioned by this repository. CI runs tests and builds a downloadable `airshift-static` artifact.

## Tuning and architecture

| File | Responsibility |
| --- | --- |
| `src/physics.js` | Pure fixed-step simulation, traffic generation, landing and collision rules |
| `src/renderer.js` | Projection, polygon meshes, scenery, shadows and camera |
| `src/main.js` | Touch/keyboard input, UI state, fixed-step accumulator, score persistence |
| `src/audio.js` | Web Audio synthesis; no external samples |
| `src/style.css` | Safe-area-aware mobile HUD, controls and overlays |

Physics runs at 120 Hz, independently of display refresh. Frame time is capped at 50 ms to prevent a stalled/backgrounded frame from teleporting through traffic. Long stalls slow the run rather than skipping collisions. Traffic and scenery are discarded behind the player, and coordinates stay relative to the car.

Current tuning: 27 m/s at the start, roughly 38 m/s at 10 seconds, 44 m/s at 15 seconds, 58 m/s at 30 seconds and 73 m/s at one minute, tapering smoothly toward 80 m/s. Launch preload is 0.11 s, with approximately 2.3 s of full pressure and 3.1 s empty-to-full ground recharge. A gentle rise drag and diminishing lift keep the car inside the readable camera envelope without a hard invisible ceiling. Perfect landings require less than 5° roll and a descent below 4.8 m/s; rough landings begin above 15° or 7.7 m/s; more than 25° or 11.5 m/s ends the run. Finish lane changes before touchdown.

Traffic density follows a smooth difficulty signal with seeded timing and vehicle choices rather than a repeating phase cycle. Multiple rows commonly share the forward view; normal decision gaps shrink from about 2.5 seconds early to under a second late. Irregular 7–9-row peak sequences arrive occasionally, using linked two-lane decisions and sometimes ending in a jump wall, then a short recovery row. Vehicle lengths vary from compact cars through long trucks; row spacing accounts for full vehicle envelopes. Each non-wall row leaves an open lane connected to the previous safe route. Walls contain only low cars, retain at least 4.2 seconds of approach, stay well separated, and are followed by a short recovery window. Shared traffic flow prevents incidental overtaking from generating unplanned impossible blocks. Difficulty comes from connected decisions and denser traffic, not random physics errors.

## Verification and limits

`npm test` covers thrust duration, descent braking, pressure recharge, lane motion, landing categories, roof/road/swept collisions, crash freezing, a successful three-lane jump, speed progression, visible traffic density against the previous pacing baseline, peak sequences, irregular seeded timing, 160-seed route and wall safety, and late jumpability. The DOM harness checks touch cancellation, simultaneous thumbs, pause/resume, persistence and retry.

Portrait and landscape scenes were rendered and visually inspected with a software Canvas implementation. **This prototype has not yet been playtested on a physical phone or in a real browser.** DOM-harness checks do not validate browser layout, browser audio policies, or actual touch feel. Before treating it as release-ready, test iOS Safari and Android Chrome, including rotation, safe areas, multi-touch, app switching and audio interruption. Device performance and fun still need hands-on validation.

Intentionally deferred: tunnels/overhead hazards, multiple environments, traffic lane-changing AI, online leaderboards, install/offline support, progression, shops, and accounts.
