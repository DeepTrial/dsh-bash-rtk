/**
 * tsdown preset for dsh-bash-rtk: a single ESM node half with declarations.
 * The plugin is host-side only (no browser bundle) — it wraps the shell
 * executor seam, which lives on the host. Harness platform modules stay
 * external via peerDependencies.
 */
import type { UserConfig } from 'tsdown'

export default [
  {
    entry: { index: 'src/index.ts', wrap: 'src/wrap.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: {
      neverBundle: [
        'cordis',
        '@deepseek-ai/dsh-bash-local',
        '@deepseek-ai/dsh-bash-sandbox',
        '@deepseek-ai/dsh-shell',
      ],
    },
  },
] satisfies UserConfig[]
