import type { CommandApi, CommandSpec, GameContext, Player } from './api/types';

/** Splits a command line into words; double quotes group words with spaces. */
function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2]);
  return out;
}

/** Registry and runner for slash commands (`/give iron_sword 2`). */
export class Commands implements CommandApi {
  private cmds = new Map<string, CommandSpec>();

  constructor(
    private ctx: () => GameContext,
    /** Cheats are on: developer tools (`cheat: true`) exist. */
    private cheats = true,
  ) {}

  register(name: string, spec: CommandSpec) {
    // Without cheats, a developer tool isn't there at all.
    if (spec.cheat && !this.cheats) return;
    this.cmds.set(name.toLowerCase().replace(/^\/+/, ''), spec);
  }

  list(): [string, CommandSpec][] {
    return [...this.cmds.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  run(line: string): string {
    return this.exec(line).text;
  }

  /** Runs a line typed by `player` (default: the player); `ok` is false for unknown commands and thrown errors. */
  exec(line: string, player?: Player): { ok: boolean; text: string } {
    const words = tokenize(line.trim().replace(/^\/+/, ''));
    if (!words.length) return { ok: true, text: '' };
    const name = words[0].toLowerCase();
    const cmd = this.cmds.get(name);
    if (!cmd) return { ok: false, text: `Unknown command /${name}. Try /help` };
    try {
      const ctx = this.ctx();
      return { ok: true, text: cmd.run(words.slice(1), ctx, player ?? ctx.player) ?? '' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, text: cmd.usage ? `${msg}\nUsage: /${name} ${cmd.usage}` : msg };
    }
  }

  /** Candidates for the word being typed at the end of `line`, and where that word starts. */
  complete(line: string): { start: number; options: string[] } {
    const body = line.replace(/^\/+/, '');
    const offset = line.length - body.length;
    const words = body.split(/\s+/);
    const current = words[words.length - 1] ?? '';
    const start = line.length - current.length;
    let pool: string[];
    if (words.length <= 1) {
      pool = [...this.cmds.keys()];
      return { start: Math.max(start, offset), options: pool.filter((c) => c.startsWith(current.toLowerCase())).sort() };
    }
    const cmd = this.cmds.get(words[0].toLowerCase());
    pool = cmd?.complete?.(words.slice(1), this.ctx()) ?? [];
    return { start, options: pool.filter((c) => c.toLowerCase().startsWith(current.toLowerCase())).sort() };
  }
}
