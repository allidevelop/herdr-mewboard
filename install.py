#!/usr/bin/env python3
"""Install the Mewboard mod into Herdr. Dry run by default; never replaces a
key binding or a mod that is not this one.

  py install.py --apply              install (python3 on macOS)
  py install.py --update --apply     replace the mod's files, keep mewboard.local.json
  py install.py --uninstall --apply  remove the mod and its unchanged key binding
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'mods' / 'mewboard'
FILES = ('main.js', 'model.js', 'mod.json')
PERSONAL = 'mewboard.local.json'
# Herdr's defaults use Cmd on macOS and Ctrl elsewhere.
KEYS = ROOT / ('keys.json' if sys.platform == 'darwin' else 'keys.windows.json')
MARK = '.herdr-mewboard-install.json'


def read_json(path, default):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default


def write_json(path, value):
    temp = path.with_name(path.name + '.mewboard-tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    os.replace(temp, path)


def bindings():
    return [(section, key, action) for section, keys in read_json(KEYS, {}).items() for key, action in keys.items()]


def install(home, apply, update=False, skip_conflicts=False):
    target = home / 'mods' / 'mewboard'
    mark = target / MARK
    if target.exists() and not mark.exists():
        raise SystemExit(f'Not completed: {target} exists and was not installed by this script.')
    if target.exists() and not update:
        raise SystemExit('Not completed: already installed. Use --update.')
    keys = read_json(home / 'keys.json', {})
    added = []
    for section, key, action in bindings():
        have = keys.get(section, {}).get(key)
        if have is None:
            keys.setdefault(section, {})[key] = action
            added.append([section, key, action])
        elif have != action:
            if not skip_conflicts:
                raise SystemExit(f'Not completed: {section} / {key} is already bound to "{have}". Use --skip-conflicting-keys to keep it.')
            print(f'KEEP existing binding: {section} / {key}')
    print(f'{"UPDATE" if update else "INSTALL"}{"" if apply else " (plan)"}: {len(FILES)} files, {len(added)} new bindings -> {target}')
    if not apply:
        return
    target.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        shutil.copyfile(SOURCE / name, target / name)
    previous = read_json(mark, {}).get('added_keys', [])
    write_json(mark, {'added_keys': previous + added})
    if added:
        write_json(home / 'keys.json', keys)
    print('Done. Open it with ' + ', '.join(f'{k}' for _, k, _ in bindings()) + ' in Herdr.')


def uninstall(home, apply):
    target = home / 'mods' / 'mewboard'
    mark = target / MARK
    if not mark.exists():
        raise SystemExit('Not completed: not installed by this script.')
    keys = read_json(home / 'keys.json', {})
    for section, key, action in read_json(mark, {}).get('added_keys', []):
        if keys.get(section, {}).get(key) == action:
            del keys[section][key]
    print(f'REMOVE{"" if apply else " (plan)"}: {target}' + ('' if not (target / PERSONAL).exists() else f' (keeps {PERSONAL})'))
    if not apply:
        return
    for name in (*FILES, MARK):
        (target / name).unlink(missing_ok=True)
    try:
        target.rmdir()
    except OSError:
        pass  # mewboard.local.json or files Herdr's check created stay
    write_json(home / 'keys.json', keys)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--home', type=Path, default=Path(os.environ.get('HERDR_APP_HOME', str(Path.home() / '.config' / 'herdr-app'))))
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--update', action='store_true')
    parser.add_argument('--uninstall', action='store_true')
    parser.add_argument('--skip-conflicting-keys', action='store_true')
    args = parser.parse_args()
    home = args.home.resolve()
    if not (home / 'mods').is_dir():
        raise SystemExit(f'Not completed: no Herdr home at {home}. Open Herdr once first.')
    if args.uninstall:
        uninstall(home, args.apply)
    else:
        install(home, args.apply, args.update, args.skip_conflicting_keys)


if __name__ == '__main__':
    main()
