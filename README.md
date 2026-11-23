# Syllabus Buddy

Day-1 spike: Firebase App Check, Anonymous Auth and Firebase AI Logic in hybrid mode, with a diagnostics page that runs one structured-output prompt.

Licensed under Apache-2.0.

## Run

1. Follow [docs/firebase-setup.md](docs/firebase-setup.md) to create the Firebase resources and `.env.local`.
2. `npm install`
3. `npm run dev`
4. `npm test -- --run` for unit tests, `npm run build` for a type-checked build.

## Owner checks

1. Page loads: an anonymous user ID shows and there is no App Check error.
2. Set `VITE_INFERENCE_MODE=only_in_cloud`, run the sample reply "I added 5 and 3 and got 8": valid turn JSON with `IN_CLOUD`.
3. In Nano-ready Chrome with `prefer_on_device`, click "Prepare on-device model", turn Wi-Fi off, run again: valid turn JSON with `ON_DEVICE`.

## Nano structured output finding

Status: **works** (checked 2026-11-23 on desktop Chrome, macOS).

- On-device: Gemini Nano returns valid turn JSON through `responseConstraint`, including with Wi-Fi off. The badge shows `ON_DEVICE`.
- Cloud: `gemini-3.5-flash-lite` returns valid turn JSON through `responseJsonSchema`. The badge shows `IN_CLOUD`.
- `gemini-2.5-flash` is retired for new projects. `gemini-3.8-flash` was too slow for per-turn classification, even with `ThinkingLevel.LOW` (it rejects `MINIMAL`), so keep it for the tutor agent only.
