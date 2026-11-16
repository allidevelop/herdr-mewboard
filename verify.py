#!/usr/bin/env python3
"""All checks: JSON, LF files, the model and popup tests (Node.js), the installer tests."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
for path in ROOT.rglob('*'):
    if '.git' in path.parts or not path.is_file() or path.suffix not in {'.js', '.mjs', '.json', '.py', '.md'}:
        continue
    text = path.read_text(encoding='utf-8')
    assert '\r\n' not in text, f'CRLF line endings: {path}'
    if path.suffix == '.json':
        json.loads(text)
print('JSON and line endings: PASS', flush=True)
subprocess.run(['node', str(ROOT / 'tests' / 'test_model.mjs')], check=True)
subprocess.run(['node', '--experimental-vm-modules', '--no-warnings', str(ROOT / 'tests' / 'test_main.mjs')], check=True)
subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], cwd=ROOT, check=True)
print('All checks passed.')
