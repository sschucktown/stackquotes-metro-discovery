import { execSync } from "child_process";

function run(cmd: string) {
  console.log(`\n$ ${cmd}`);
  console.log(execSync(cmd, { encoding: "utf8" }));
}

run("pwd");
run("ls");
run("ls scripts");
run("ls scripts/trust-proxy || echo 'NO trust-proxy DIR'");
run("ls scripts/trust-proxy | sed 's/^/  - /' || true");
