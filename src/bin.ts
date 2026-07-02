import { runGarnish } from "./cli/real";

/** Executable entrypoint: `bun run garnish …` or the {root}/bin/garnish shim. */
if (import.meta.main) {
  const outcome = await runGarnish(process.argv.slice(2));
  if (outcome.text.length > 0) {
    console.log(outcome.text);
  }
  process.exit(outcome.exitCode);
}
