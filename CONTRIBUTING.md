# Contributing to NDI Video Monitor

Thank you for considering contributing to this project!

## Development Setup

1. Follow the installation instructions in the README.md
2. Make sure all prerequisites are installed (NDI SDK, Node.js)
3. Native C binaries auto-compile on first run; you can also pre-compile manually if needed

## How to Contribute

### Reporting Bugs

- Check if the bug has already been reported in Issues
- Include your OS, Node.js version, and NDI SDK version
- Provide steps to reproduce the issue
- Include relevant error messages or logs

### Suggesting Features

- Open an issue describing the feature
- Explain the use case and why it would be useful
- Consider if it fits the project's scope

### Submitting Changes

1. Fork the repository
2. Create a new branch (`git checkout -b feature/your-feature-name`)
3. Make your changes
4. Test on at least one platform, and include cross-platform notes for any platform-specific behavior
5. Update documentation if needed
6. Commit your changes (`git commit -am 'Add some feature'`)
7. Push to the branch (`git push origin feature/your-feature-name`)
8. Open a Pull Request

## Code Style

- Use consistent indentation (2 spaces for JS, 4 for C)
- Add comments for complex logic
- Follow existing naming conventions
- Keep functions focused and modular

## Testing

- Test NDI source discovery with multiple sources
- Test stream switching functionality
- Verify no memory leaks during long sessions
- Check performance with high-resolution sources
- Verify WebRTC playback in webrtc_viewer.html
- Validate stats reporting (FPS/latency) from /api/stats

## Platform Support

Cross-platform (macOS, Windows, Linux) support is included:
- Document platform-specific changes
- Update compilation instructions if SDK paths differ
- Update .gitignore for platform binaries

## Questions?

Open an issue or discussion for any questions about contributing.
