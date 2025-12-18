/**
 * Command Parser
 * Parses raw input strings into structured command objects
 * No system shell execution - purely internal command parsing
 */

export class CommandParser {
  constructor() {
    this.commands = new Map();
  }

  register(name, aliases = [], minArgs = 0, maxArgs = Infinity) {
    const cmd = { name, aliases, minArgs, maxArgs };
    this.commands.set(name, cmd);
    for (const alias of aliases) {
      this.commands.set(alias, cmd);
    }
  }

  parse(input) {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const parts = this.tokenize(trimmed);
    if (parts.length === 0) return null;

    const cmdName = parts[0].toLowerCase();
    const args = parts.slice(1);

    const cmdDef = this.commands.get(cmdName);
    if (!cmdDef) {
      return {
        type: 'error',
        error: `Unknown command: ${cmdName}`,
      };
    }

    if (args.length < cmdDef.minArgs) {
      return {
        type: 'error',
        error: `${cmdDef.name} requires at least ${cmdDef.minArgs} argument(s)`,
      };
    }

    if (args.length > cmdDef.maxArgs) {
      return {
        type: 'error',
        error: `${cmdDef.name} accepts at most ${cmdDef.maxArgs} argument(s)`,
      };
    }

    return {
      type: 'command',
      command: cmdDef.name,
      args,
      raw: trimmed,
    };
  }

  tokenize(input) {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = null;
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }
}
