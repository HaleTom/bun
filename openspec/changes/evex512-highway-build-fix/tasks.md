## 1. Fix Highway compile flags

- [ ] 1.1 Add `-U__EVEX512__` to non-Windows Highway cflags in `scripts/build/deps/highway.ts`

## 2. Verify fix

- [ ] 2.1 Regenerate build.ninja (reconfigure)
- [ ] 2.2 Rebuild and confirm no EVEX512 errors in Highway
- [ ] 2.3 Verify bun binary runs (`./build/debug/bun-debug --revision`)
- [ ] 2.4 Return to nested-resolutions verification tasks 11.8 and 11.9

## 3. Document

- [ ] 3.1 Commit with descriptive message
- [ ] 3.2 Note the fix rationale in the commit message
