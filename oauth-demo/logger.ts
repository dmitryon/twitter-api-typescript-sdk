const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
};

function timestamp() {
  return `${colors.dim}${new Date().toISOString()}${colors.reset}`;
}

function formatArgs(args: any[]): any[] {
  return args.map(a =>
    typeof a === "object" && a !== null ? JSON.stringify(a, null, 2) : a
  );
}

export const log = {
  info(tag: string, ...args: any[]) {
    console.log(`${timestamp()} ${colors.green}INFO${colors.reset}  ${colors.cyan}[${tag}]${colors.reset}`, ...formatArgs(args));
  },
  debug(tag: string, ...args: any[]) {
    console.log(`${timestamp()} ${colors.blue}DEBUG${colors.reset} ${colors.cyan}[${tag}]${colors.reset}`, ...formatArgs(args));
  },
  warn(tag: string, ...args: any[]) {
    console.warn(`${timestamp()} ${colors.yellow}WARN${colors.reset}  ${colors.cyan}[${tag}]${colors.reset}`, ...formatArgs(args));
  },
  error(tag: string, ...args: any[]) {
    console.error(`${timestamp()} ${colors.bgRed}${colors.white}ERROR${colors.reset} ${colors.cyan}[${tag}]${colors.reset}`, ...formatArgs(args));
  },
};
