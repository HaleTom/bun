# evex512-highway-build-fix Design

## Problem

### Failure Mode

Bun's build compiles vendored Google Highway (SIMD string fastpaths) with `-march=haswell`.
On certain clang 22 + Linux host combinations, the compiler defines `__EVEX512__` as a
built-in capability macro even though the effective TU target is haswell (AVX2 max).

Highway's `vendor/highway/hwy/ops/set_macros-inl.h:143` activates an `evex512` target
variant when it sees this macro:

```c
#if (HWY_COMPILER_CLANG >= 1800 && defined(__EVEX512__) && HWY_ARCH_X86)
#define HWY_TARGET_STR_AVX3_VL512 ",evex512"
```

The `foreach_target.h` mechanism then emits a `#pragma clang attribute push(target("evex512"))`
and compiles AVX512 intrinsics from `x86_512-inl.h`. These fail because the surrounding TU
context was compiled without AVX512 support:

```
error: always_inline function '_kandn_mask64' requires target feature 'avx512bw',
       but would be inlined into function 'AndNot' that is compiled without support for 'avx512bw'
error: AVX vector return of type '__m512i' without 'avx512f' enabled changes the ABI
```

~41 errors per Highway source file, all variants of the same AVX512 feature mismatch.

### Why CI Does Not Fail

CI uses different clang versions or runs on hardware where the pragma + march combination
does not activate the failing path. The bug is specific to clang 22 on Linux with
`-march=haswell` on non-AVX512 hardware.

## Fix

### Chosen Approach

Add `-U__EVEX512__` to Highway's non-Windows compile flags in `scripts/build/deps/highway.ts`.

This undefines `__EVEX512__` before Highway sees it, so the condition:

```c
defined(__EVEX512__)
```

is always false for Highway compilation. The `HWY_TARGET_STR_AVX3_VL512` macro is never
set `",evex512"`, so the AVX512 target is never added to `foreach_target.h`'s target list
and no AVX512 code is compiled.

### Why This Fix

| Criterion | Verdict |
|-----------|---------|
| Scoped to Highway only | ✓ — only Highway's cflags change |
| No vendored source changes | ✓ — no edits to `vendor/highway/` |
| Reversible in one line | ✓ — remove one flag to revert |
| Directly targets the trigger | ✓ — prevents `__EVEX512__` at the source |
| Does not change CPU target | ✓ — Bun still builds for haswell |

### Alternatives Considered

1. **Patch `vendor/highway/...`**
   - More brittle during dependency refreshes.
   - Easy to lose on Highway version bump.

2. **`HWY_DISABLED_TARGETS=464`**
   - Does not prevent the `#pragma clang attribute push(target("evex512"))` from firing.
   - The pragma bypasses the disabled-targets mask.

3. **`-mno-evex512` flag**
   - Not a valid clang flag (GCC-only).

4. **Change global `-march`**
   - Affects Bun's intended CPU baseline.
   - Broadens risk to all other targets.

5. **Use a different clang**
   - Does not fix the underlying issue; just avoids one compiler.

### Implementation

In `scripts/build/deps/highway.ts`, update the Linux/non-Windows cflags from:

```ts
cflags: cfg.windows
  ? ["-D_HAS_EXCEPTIONS=0"]
  : ["-fno-exceptions", "-fmath-errno", "-Wno-ignored-attributes"],
```

to:

```ts
cflags: cfg.windows
  ? ["-D_HAS_EXCEPTIONS=0"]
  : ["-fno-exceptions", "-fmath-errno", "-Wno-ignored-attributes", "-U__EVEX512__"],
```

The `-U` flag is a simple undef — it removes the macro definition before Highway's headers
are processed. It has no effect on non-clang compilers or on platforms where `__EVEX512__`
is not defined.

### Validation

1. Regenerate build with `bun run build --configure-only` (or full rebuild).
2. Rebuild with the installed clang21 toolchain.
3. Confirm no EVEX512 / avx512f / avx512bw errors in Highway compilation.
4. Confirm no regressions in other targets.
5. Verify bun binary runs (`./build/debug/bun-debug --revision`).
