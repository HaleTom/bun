# evex512-highway-build-fix

## Summary

Bun's Linux build fails in vendored Google Highway when clang exposes the `__EVEX512__`
compiler-macro while the build still targets `-march=haswell`. Highway then enables an
`evex512` target variant and compiles AVX512 intrinsics that are incompatible with the
effective translation-unit target, producing ~41 build errors per highway source file.
These errors are unrelated to any feature code — they block build verification for any
branch compiled on this machine.

## Goal

Stabilize the build by suppressing Highway's accidental EVEX512 target selection on
non-AVX512 hosts, using the smallest build-system-scoped fix.

## Motivation

- The failure blocks unrelated feature verification.
- The issue is environmental (toolchain + host CPU combination), not a logic bug.
- The fix should live in the build configuration, not in arbitrary feature branches.
- Only Highway is affected — no other dep or Bun's own sources need this flag.

## Scope

- **In scope:** `scripts/build/deps/highway.ts` cflags, Highway-only compilation.
- **Out of scope:** changes to `-march`, global compiler flags, vendored Highway source,
  or any other dependency.

## Status

- [ ] Proposed
- [ ] Designed
- [ ] Implemented
- [ ] Verified
