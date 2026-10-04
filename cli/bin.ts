import { run } from "./main.ts";

process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (t) => process.stdout.write(t + "\n"),
  err: (t) => process.stderr.write(t + "\n"),
});
