# Changelog

All notable changes to DemoTyper will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2024-12-12

### Added
- **Smart Guard & Forward-Only Split** - New algorithm to prevent infinite loops
- **Closing-Prefix Match Guard** - Handle `} catch`, `} else`, `} finally` patterns
- **Comment Split Guard** - Properly handle comment-only lines blocking code
- **Rigid Pair Identity Check** - Strict bracket pairing validation
- **Weak Anchor Guard** - Prevent structural-only lines from causing mismatches

### Fixed
- Fixed infinite loop when typing `} catch (error) {` patterns
- Fixed sticky bracket issue where closing brackets would attach to wrong lines
- Fixed duplicate closing brackets in nested structures
- Fixed indent correction for closing-only lines
- Fixed comment lines being incorrectly matched as flexible anchors

### Changed
- Improved gap detection algorithm for better accuracy
- Enhanced logging for easier debugging
- Optimized placeholder drift correction

## [1.0.0] - 2024-11-26

### Added
- Initial release
- Secret typing mode with Smart Replace algorithm
- Target file management via context menu
- Bracket auto-pairing support (`{}`, `()`, `[]`)
- Smart brace expansion for code blocks
- Single cursor enforcement
- Undo-friendly batch operations
- Debug info command
- Configurable logging and notifications

### Features
- Line-based diff algorithm for accurate character insertion
- Placeholder tracking for cross-line bracket pairs
- Automatic newline detection and prompting
- Multi-file support with per-file target tracking

---

## Version History Summary

| Version | Date | Highlights |
|---------|------|------------|
| 1.1.0 | 2024-12-12 | Smart Guard, `} catch` fix, infinite loop prevention |
| 1.0.0 | 2024-11-26 | Initial release with core functionality |
