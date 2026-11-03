"""Exercise the actual installer and deploy guard with a simulated host filesystem."""
import os
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture()
def host(tmp_path):
    root = tmp_path / 'host'
    commands = tmp_path / 'bin'
    commands.mkdir()
    log = tmp_path / 'commands.log'
    fake = '''#!/usr/bin/env python3
import os, sys, shutil
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['COMMAND_LOG'], 'a') as stream:
    stream.write(name + ' ' + ' '.join(args) + '\\n')
if os.environ.get('FAIL_COMMAND') == name:
    sys.exit(1)
root = Path(os.environ['HOST_ROOT'])
if name == 'install':
    if '-d' in args:
        for arg in args[args.index('755') + 1:]:
            (root / arg.lstrip('/')).mkdir(parents=True, exist_ok=True)
    else:
        target = root / args[-1].lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args[-2], target)
        target.chmod(int(args[args.index('-m') + 1], 8))
if name == 'systemctl' and args[0] == 'start' and '--no-block' not in args:
    sys.exit(95)
'''
    for name in ('install', 'systemctl'):
        path = commands / name
        path.write_text(fake)
        path.chmod(0o755)
    checkout = tmp_path / 'home' / 'deployer' / 'checkout'
    shutil.copytree(REPO / 'ops', checkout / 'ops')
    env = {**os.environ, 'PATH': f'{commands}:{os.environ["PATH"]}',
           'HOST_ROOT': str(root), 'COMMAND_LOG': str(log)}
    return checkout, root, log, env


@pytest.mark.parametrize('environment', ['staging', 'production'])
def test_installer_uses_fixed_script_path_and_nonblocking_start(host, environment):
    checkout, root, log, env = host
    subprocess.run(['bash', 'ops/install_diagnostics.sh', environment], cwd=checkout, env=env, check=True)
    unit = (root / 'etc/systemd/system/epic-stocks-diagnostics.service').read_text()
    assert 'ExecStart=/usr/bin/python3 /usr/local/lib/epic-stocks/collect_diagnostics.py' in unit
    assert f'--environment {environment}' in unit
    assert 'ProtectHome=true' in unit
    assert str(checkout) not in unit and '@' not in unit
    assert (root / 'usr/local/lib/epic-stocks/collect_diagnostics.py').read_bytes() == (REPO / 'ops/collect_diagnostics.py').read_bytes()
    assert 'systemctl start --no-block epic-stocks-diagnostics.service' in log.read_text()


@pytest.mark.parametrize('failed_command', ['install', 'systemctl'])
def test_diagnostics_failure_does_not_abort_deploy(host, failed_command):
    checkout, root, log, env = host
    (checkout / '.env').write_text('APP_ENV=staging\n')
    env['FAIL_COMMAND'] = failed_command
    workflow = (REPO / '.github/workflows/deploy.yml').read_text()
    start = workflow.index('            if ! bash ops/install_diagnostics.sh')
    end = workflow.index('            fi\n', start) + len('            fi\n')
    actual_guard = textwrap.dedent(workflow[start:end])
    result = subprocess.run(['bash', '-euc', actual_guard + '\nprintf "app-deploy-continues"\n'],
                            cwd=checkout, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert '::warning::Host diagnostics setup failed' in result.stdout
    assert 'app-deploy-continues' in result.stdout


def test_installer_refuses_invalid_environment_before_host_changes(host):
    checkout, root, log, env = host
    result = subprocess.run(['bash', 'ops/install_diagnostics.sh', 'unexpected'],
                            cwd=checkout, env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert not root.exists() and not log.exists()
