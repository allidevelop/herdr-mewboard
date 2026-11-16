import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer', ROOT / 'install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
KEY = next(iter(json.loads(installer.KEYS.read_text(encoding='utf-8'))['global']))


class Install(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        (self.home / 'mods').mkdir()
        (self.home / 'keys.json').write_text(json.dumps({'global': {'ctrl-shift-p': 'app.palette'}}), encoding='utf-8')
        self.quiet = contextlib.redirect_stdout(io.StringIO()); self.quiet.__enter__()

    def tearDown(self):
        self.quiet.__exit__(None, None, None)
        self.tmp.cleanup()

    def keys(self):
        return json.loads((self.home / 'keys.json').read_text(encoding='utf-8'))

    def test_plan_writes_nothing(self):
        installer.install(self.home, apply=False)
        self.assertFalse((self.home / 'mods' / 'mewboard').exists())
        self.assertNotIn(KEY, self.keys()['global'])

    def test_install_update_uninstall_keep_other_keys_and_local_settings(self):
        installer.install(self.home, apply=True)
        mod = self.home / 'mods' / 'mewboard'
        self.assertEqual((mod / 'main.js').read_bytes(), (ROOT / 'mods/mewboard/main.js').read_bytes())
        self.assertEqual(self.keys()['global'][KEY], 'mod.open:mewboard')
        (mod / 'mewboard.local.json').write_text('{"base": "https://mb.example"}', encoding='utf-8')
        with self.assertRaises(SystemExit):
            installer.install(self.home, apply=True)
        installer.install(self.home, apply=True, update=True)
        self.assertTrue((mod / 'mewboard.local.json').exists())
        installer.uninstall(self.home, apply=True)
        self.assertEqual(self.keys(), {'global': {'ctrl-shift-p': 'app.palette'}})
        self.assertFalse((mod / 'main.js').exists())
        self.assertTrue((mod / 'mewboard.local.json').exists(), 'personal settings stay')

    def test_foreign_mod_and_taken_key_stop_before_writing(self):
        (self.home / 'mods' / 'mewboard').mkdir()
        with self.assertRaises(SystemExit):
            installer.install(self.home, apply=True)
        (self.home / 'mods' / 'mewboard').rmdir()
        (self.home / 'keys.json').write_text(json.dumps({'global': {KEY: 'something.else'}}), encoding='utf-8')
        with self.assertRaises(SystemExit):
            installer.install(self.home, apply=True)
        self.assertFalse((self.home / 'mods' / 'mewboard').exists())
        installer.install(self.home, apply=True, skip_conflicts=True)
        self.assertEqual(self.keys()['global'][KEY], 'something.else')


if __name__ == '__main__':
    unittest.main(verbosity=2)
