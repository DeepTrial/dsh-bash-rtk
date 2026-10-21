/**
 * tsdown preset for dsh-bash-rtk: ESM node halves with declarations — the
 * executor (`index`), the pure wrap logic (`wrap`) and the `/rtk` command
 * (`command`). The plugin is host-side only (no browser bundle): it wraps the
 * shell executor seam and registers a command, both of which live on the host.
 * Harness platform modules stay external via peerDependencies.
 */
import type { UserConfig } from 'tsdown'

export default [
  {
    entry: { index: 'src/index.ts', wrap: 'src/wrap.ts', command: 'src/command.ts', stats: 'src/stats.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: {
      neverBundle: [
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-bash-local',
        '@deepseek-ai/dsh-bash-sandbox',
        '@deepseek-ai/dsh-shell',
      ],
    },
  },
] satisfies UserConfig[]
