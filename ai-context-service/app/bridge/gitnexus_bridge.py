import asyncio
import json
import logging
import os
from pathlib import Path

from app.config import settings

logger = logging.getLogger("ai-context-service.bridge")


class GitNexusBridge:
    def __init__(self):
        self._cli_env = {
            **os.environ,
            "GITNEXUS_HOME": settings.GITNEXUS_HOME,
        }
        if settings.OPENAI_API_KEY:
            self._cli_env["OPENAI_API_KEY"] = settings.OPENAI_API_KEY
        if settings.OPENAI_BASE_URL:
            self._cli_env["OPENAI_BASE_URL"] = settings.OPENAI_BASE_URL

    async def close(self):
        pass

    # ── CLI helpers ──

    async def _run_cli(
        self, args: list[str], cwd: str | None = None, timeout: int = 1800
    ) -> tuple[int, str, str]:
        import signal

        cmd = [settings.GITNEXUS_CLI_PATH] + args
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            env=self._cli_env,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            preexec_fn=os.setsid,
        )

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, OSError):
                proc.kill()
            raise RuntimeError(f"CLI command timed out: {' '.join(cmd)}")
        output = stdout.decode(errors="replace")
        err_output = stderr.decode(errors="replace")
        logger.debug("cli %s: %d bytes stdout, %d bytes stderr", " ".join(args), len(output), len(err_output))
        if err_output.strip():
            logger.debug("cli stderr: %s", err_output[:500])
        return proc.returncode, output, err_output

    # ── Git operations (system git, not gitnexus) ──

    async def _run_git(
        self, args: list[str], cwd: str | None = None, timeout: int = 300
    ) -> tuple[int, str, str]:
        import signal

        proc = await asyncio.create_subprocess_exec(
            "git", *args,
            cwd=cwd,
            env=self._cli_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            preexec_fn=os.setsid,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, OSError):
                proc.kill()
            raise RuntimeError(f"git command timed out: git {' '.join(args)}")
        return proc.returncode, stdout.decode(), stderr.decode()

    @staticmethod
    def _inject_git_credentials(git_url: str, username: str | None, token: str | None) -> str:
        if not username or not token:
            logger.warning(f"No git credentials provided for {git_url}")
            return git_url
        from urllib.parse import urlparse, urlunparse, quote
        parsed = urlparse(git_url)
        if parsed.username:
            return git_url
        netloc = f"{quote(username, safe='')}:{quote(token, safe='')}@{parsed.hostname}"
        if parsed.port:
            netloc += f":{parsed.port}"
        result = urlunparse(parsed._replace(netloc=netloc))
        logger.info(f"Injected git credentials for {parsed.hostname}")
        return result

    async def clone_or_pull(self, git_url: str, repo_path: str, branch: str = "main",
                            gitlab_username: str | None = None, gitlab_token: str | None = None) -> None:
        auth_url = self._inject_git_credentials(git_url, gitlab_username, gitlab_token)
        repo_dir = Path(repo_path)
        if repo_dir.exists() and (repo_dir / ".git").exists():
            rc, out, err = await self._run_git(
                ["pull", "--ff-only"], cwd=repo_path, timeout=300
            )
            if rc != 0:
                raise RuntimeError(f"git pull failed: {err}")
        else:
            repo_dir.parent.mkdir(parents=True, exist_ok=True)
            rc, out, err = await self._run_git(
                ["clone", "-b", branch, auth_url, repo_path], timeout=600
            )
            if rc != 0:
                raise RuntimeError(f"git clone failed: {err}")

    async def get_current_commit(self, repo_path: str) -> str:
        rc, out, _ = await self._run_git(
            ["rev-parse", "HEAD"], cwd=repo_path, timeout=30
        )
        if rc != 0:
            raise RuntimeError("Failed to get current commit")
        return out.strip()[:40]

    # ── GitNexus CLI: analyze ──

    async def analyze(self, repo_path: str, force: bool = False) -> None:
        args = ["analyze", repo_path]
        if force:
            args.append("--force")
        rc, out, err = await self._run_cli(args, timeout=1800)
        if rc != 0:
            raise RuntimeError(f"gitnexus analyze failed: {err}")
        logger.info(f"Analyze completed for {repo_path}")

        # Register into global registry so serve/mcp can query it
        rc2, _, err2 = await self._run_cli(["index", repo_path], timeout=60)
        if rc2 != 0:
            logger.warning(f"gitnexus index registration failed: {err2}")
        else:
            logger.info(f"Registered {repo_path} into GitNexus global registry")

    # ── GitNexus CLI: wiki ──

    async def generate_wiki(self, repo_path: str, force: bool = False) -> None:
        args = ["wiki", repo_path, "-v"]
        if force:
            args.append("--force")
        if settings.GITNEXUS_WIKI_MODEL:
            args.extend(["--model", settings.GITNEXUS_WIKI_MODEL])
        if settings.OPENAI_BASE_URL:
            args.extend(["--base-url", settings.OPENAI_BASE_URL])
        if settings.OPENAI_API_KEY:
            args.extend(["--api-key", settings.OPENAI_API_KEY])
        logger.info(f"Running gitnexus wiki: {' '.join(args)}")
        rc, out, err = await self._run_cli(args, timeout=3600)
        if rc != 0:
            raise RuntimeError(f"gitnexus wiki failed (rc={rc}): {err or out}")
        logger.info(f"Wiki generated for {repo_path}")

    # ── GitNexus CLI: group management ──

    async def group_create(self, group_name: str) -> None:
        rc, _, err = await self._run_cli(["group", "create", group_name])
        if rc != 0 and "already exists" not in err:
            logger.warning(f"group create {group_name} failed: {err}")

    async def group_add(self, group_name: str, repo_path: str, registry_name: str) -> None:
        rc, _, err = await self._run_cli(
            ["group", "add", group_name, repo_path, registry_name]
        )
        if rc != 0:
            logger.warning(f"group add failed: {err}")

    async def group_sync(self, group_name: str) -> None:
        rc, _, err = await self._run_cli(["group", "sync", group_name], timeout=300)
        if rc != 0:
            logger.warning(f"group sync failed: {err}")

    # ── GitNexus CLI: search / query ──

    async def search(
        self, query: str, repo: str | None = None, mode: str = "hybrid", limit: int = 20
    ) -> dict:
        q = query.strip() or "*"
        args = ["query", q, "-l", str(limit)]
        if repo:
            args.extend(["-r", repo])
        rc, out, err = await self._run_cli(args, timeout=120)
        if rc != 0:
            raise RuntimeError(f"gitnexus query failed: {err}")
        return json.loads(out) if out.strip() else {"processes": [], "process_symbols": [], "definitions": []}

    async def query(
        self, query: str, repo: str | None = None, limit: int = 10
    ) -> dict:
        q = query.strip() or "*"
        args = ["query", q, "-l", str(limit)]
        if repo:
            args.extend(["-r", repo])
        rc, out, err = await self._run_cli(args, timeout=120)
        if rc != 0:
            raise RuntimeError(f"gitnexus query failed: {err}")
        return json.loads(out) if out.strip() else {"processes": [], "process_symbols": [], "definitions": []}

    # ── GitNexus: repos (read registry.json directly) ──

    async def get_repos(self) -> list[dict]:
        registry_path = Path(settings.GITNEXUS_HOME) / "registry.json"
        if not registry_path.exists():
            return []
        return json.loads(registry_path.read_text())

    # ── GitNexus CLI: cypher ──

    async def cypher(self, query: str, repo: str | None = None) -> list | dict:
        args = ["cypher", query]
        if repo:
            args.extend(["-r", repo])
        rc, out, err = await self._run_cli(args, timeout=60)
        if rc != 0:
            raise RuntimeError(f"gitnexus cypher failed: {err}")
        return json.loads(out) if out.strip() else []

    @staticmethod
    def parse_cypher_table(result: list | dict) -> list[dict]:
        """Parse cypher markdown table result into list of dicts."""
        if isinstance(result, list):
            return result
        if not isinstance(result, dict):
            return []
        md = result.get("markdown", "")
        if not md:
            return []
        lines = [l.strip() for l in md.strip().split("\n") if l.strip()]
        if len(lines) < 3:
            return []
        # Header row
        headers = [c.strip() for c in lines[0].split("|") if c.strip()]
        # Data rows (skip separator line at index 1)
        rows = []
        for line in lines[2:]:
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if len(cells) == len(headers):
                rows.append(dict(zip(headers, cells)))
        return rows

    async def get_processes(self, repo: str) -> list[dict]:
        """Get all processes with entry points via cypher."""
        result = await self.cypher(
            "MATCH (p:Process) RETURN p.id, p.label, p.entryPointId, p.processType, p.stepCount",
            repo=repo,
        )
        rows = self.parse_cypher_table(result)
        processes = []
        for row in rows:
            entry = row.get("p.entryPointId", "")
            handler = ""
            handler_file = ""
            if entry:
                # Format: "Type:filePath:SymbolName#paramCount"
                parts = entry.split(":")
                if len(parts) >= 3:
                    handler_file = ":".join(parts[1:-1])
                    handler = parts[-1].rsplit("#", 1)[0]
            processes.append({
                "id": row.get("p.id", ""),
                "summary": row.get("p.label", ""),
                "entry_point_id": entry,
                "handler": handler,
                "handler_file": handler_file,
                "process_type": row.get("p.processType", ""),
                "step_count": int(row.get("p.stepCount", "0")),
            })
        return processes

    # ── GitNexus CLI: impact ──

    async def impact(
        self, target: str, direction: str = "upstream", depth: int = 3, repo: str | None = None
    ) -> dict:
        args = ["impact", target, "-d", direction, "--depth", str(depth)]
        if repo:
            args.extend(["-r", repo])
        rc, out, err = await self._run_cli(args, timeout=120)
        if rc != 0:
            raise RuntimeError(f"gitnexus impact failed: {err}")
        return json.loads(out) if out.strip() else {}

    # ── File reads: meta.json, wiki ──

    def read_meta_json(self, repo_path: str) -> dict | None:
        meta_path = Path(repo_path) / ".gitnexus" / "meta.json"
        if not meta_path.exists():
            return None
        return json.loads(meta_path.read_text())

    def read_wiki_index(self, repo_path: str) -> list[dict]:
        wiki_dir = Path(repo_path) / ".gitnexus" / "wiki"
        if not wiki_dir.exists():
            return []
        modules = []
        for f in sorted(wiki_dir.glob("*.md")):
            modules.append({"name": f.stem, "file": f.name})
        return modules

    def read_wiki_content(self, repo_path: str, module: str) -> str | None:
        wiki_dir = Path(repo_path) / ".gitnexus" / "wiki"
        # Accept module name with or without .md suffix
        if not module.endswith(".md"):
            module += ".md"
        wiki_file = wiki_dir / module
        if not wiki_file.exists():
            return None
        return wiki_file.read_text()

    def read_wiki_html(self, repo_path: str) -> str | None:
        html_file = Path(repo_path) / ".gitnexus" / "wiki" / "index.html"
        if not html_file.exists():
            return None
        return html_file.read_text()


bridge = GitNexusBridge()
