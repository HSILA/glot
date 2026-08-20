import subprocess
import sys
import zipfile
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent


def test_built_wheel_contains_and_loads_canonical_app_config(tmp_path):
    result = subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(tmp_path)],
        cwd=BACKEND_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0

    wheel = next(tmp_path.glob("*.whl"))
    with zipfile.ZipFile(wheel) as archive:
        assert "app/config/app.yaml" in archive.namelist()
        install_root = tmp_path / "site-packages"
        archive.extractall(install_root)

    decoy = install_root / "config" / "app.yaml"
    decoy.parent.mkdir()
    decoy.write_text("version: 999\n", encoding="utf-8")

    smoke = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                f"sys.path.insert(0, {str(install_root)!r}); "
                "from app.core.app_config import load_app_config; "
                "assert load_app_config().version == 1"
            ),
        ],
        cwd=tmp_path,
        check=False,
        capture_output=True,
        text=True,
    )
    assert smoke.returncode == 0, smoke.stderr


def test_config_preflight_runs_before_every_automated_migration():
    dockerfile = (BACKEND_ROOT / "Dockerfile").read_text(encoding="utf-8")
    startup = (BACKEND_ROOT / "scripts" / "start_backend.sh").read_text(
        encoding="utf-8"
    )
    deploy = (REPO_ROOT / "scripts" / "deploy.sh").read_text(encoding="utf-8")
    justfile = (REPO_ROOT / "justfile").read_text(encoding="utf-8")
    preflight = "python -m app.core.app_config"

    assert 'CMD ["bash", "scripts/start_backend.sh"]' in dockerfile
    assert startup.index(preflight) < startup.index("alembic_bootstrap.py")
    assert startup.index(preflight) < startup.index("alembic upgrade head")
    assert deploy.index(preflight) < deploy.index("alembic upgrade head")
    assert justfile.index(preflight) < justfile.index("alembic upgrade head")


def test_production_runtime_never_resolves_or_installs_dependencies():
    dockerfile = (BACKEND_ROOT / "Dockerfile").read_text(encoding="utf-8")
    startup = (BACKEND_ROOT / "scripts" / "start_backend.sh").read_text(
        encoding="utf-8"
    )
    deploy = (REPO_ROOT / "scripts" / "deploy.sh").read_text(encoding="utf-8")
    compose = (REPO_ROOT / "docker-compose.prod.yml").read_text(encoding="utf-8")

    assert "uv sync --frozen --no-dev --no-install-project" in dockerfile
    assert "uv run" not in startup
    assert "backend uv run" not in deploy
    assert '["/app/.venv/bin/arq"' in compose


def test_config_preflight_cli_rejects_invalid_explicit_file(tmp_path):
    invalid = tmp_path / "invalid.yaml"
    invalid.write_text("version: 1\n", encoding="utf-8")

    result = subprocess.run(
        [sys.executable, "-m", "app.core.app_config", str(invalid)],
        cwd=BACKEND_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "Invalid app config file" in result.stderr


def test_extraction_smoke_script_reads_model_from_app_config():
    smoke_script = (BACKEND_ROOT / "test_agent.py").read_text(encoding="utf-8")

    assert "get_app_config().extraction" in smoke_script
    assert "settings.extraction_agent_model" not in smoke_script
