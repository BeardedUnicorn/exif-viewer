# Repository Guidelines

## Project Structure & Module Organization
- `src/`: React + TypeScript UI; `App.tsx` orchestrates metadata tables and dialogs.
- `src-tauri/`: Rust commands (`read_exif`, `find_aesthetic_images`) plus Tauri config; keep native work and filesystem access here.
- `public/` and `index.html`: static entry point and assets; update `app-logo.png` when branding shifts.
- Configuration sits in `tauri.conf.json` and `vite.config.ts`; adjust when changing build targets or dev server host settings.

## Architecture Overview
- UI invokes Rust through `@tauri-apps/api` `invoke`; push CPU-heavy tasks into `lib.rs` helpers to keep React responsive.
- Directory scans reuse `find_aesthetic_images`; extend it with new filters instead of spawning duplicate filesystem walkers.

## Build, Test, and Development Commands
- `npm install` installs Node deps and the Tauri CLI shim.
- `npm run tauri dev` launches the desktop shell with hot reload (Vite UI + Rust watcher).
- `npm run dev` serves the web UI alone for quick component iteration.
- `npm run build` runs `tsc` then emits the Vite production bundle into `dist/`.
- `npm run tauri build` packages platform binaries; run before tagging releases.
- `cargo test` from `src-tauri/` executes Rust unit tests.

## Coding Style & Naming Conventions
- TypeScript: 2-space indents, `strict` compiler, prefer `const`; files stick to PascalCase (`App.tsx`), hooks/state camelCase.
- Rust: rely on `rustfmt`, snake_case items, return `Result<T, String>` with user-friendly error strings.
- Use double quotes and trailing commas to match existing imports; keep React renders pure and side-effect free.

## Testing Guidelines
- Add `#[cfg(test)]` modules beside new Rust helpers and run `cargo test` before PRs.
- Front-end automation is not configured—coordinate before adding Vitest/Playwright and document new scripts.
- Manual QA: `npm run tauri dev`, load varied formats, scan empty folders, tweak the score threshold to confirm validation.

## Commit & Pull Request Guidelines
- Use imperative commit subjects similar to `Add folder scanning for aesthetic score filtering`; isolate unrelated changes.
- Reference issues in commit bodies or PR descriptions and note behavioural impact.
- PRs should list verification steps (`npm run tauri dev`, `cargo test`) plus screenshots or recordings for UI updates.
- Request maintainer review before merging; prefer squash merges for a tidy history.

## Security & Configuration Tips
- Avoid logging full filesystem paths or sensitive EXIF payloads; sanitize before sending to the UI.
- Surface new env vars (e.g., `TAURI_DEV_HOST`) in `vite.config.ts` and document them in `README.md`.
