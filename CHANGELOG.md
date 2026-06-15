# Changelog

## [Unreleased]

### Breaking Changes

### Added

- Added release-process documentation and a private-app release script.
- Added top-level agent onboarding guidance for web app, bridge overlay, vendoring, testing, and release work.

### Changed

- Narrowed web bridge command validation for browser-launched pane input, splits, and agent starts.
- Added same-origin browser request checks to bridge API and WebSocket routes.

### Fixed

- Pointed the bridge launcher at the stable Herdr socket by default so the debug bridge does not
  fall back to `herdr-dev`.
- Fixed sidebar active workspace selection so explicit space picks are not overridden by a previously selected pane.
- Made terminal upload controls keyboard-operable and guarded upload status against overlapping uploads.
- Avoided duplicate default agent names when launching repeated agent splits.

### Removed
