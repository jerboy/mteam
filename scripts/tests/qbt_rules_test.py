"""RE2 unit tests with Chromium's DNR compiler options; no browser or network.

Reference: chromium/extensions/browser/api/declarative_net_request/utils.cc,
CreateRE2Options (Latin1, case sensitive, never capture, 2 KB max memory).
"""
import json
from pathlib import Path
import subprocess
import unittest

import re2

ROOT = Path(__file__).resolve().parents[2]


def compile_rule(pattern):
    options = re2.Options()
    options.encoding = re2.Options.Encoding.LATIN1
    options.case_sensitive = True
    options.never_capture = True
    options.log_errors = False
    options.max_mem = 2 << 10
    return re2.compile(pattern.encode("ascii"), options=options)


class PasswordRulesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = """
import { passwordHeaderRules } from './extension/lib/qbittorrent.js';
const urls = ['http://192.168.1.2:8080', 'https://nas.example:5443/qbt',
  'http://[::1]:8080/proxy', 'https://nas.example/' + 'long-path/'.repeat(90),
  'https://nas.example/a.b+(c)/%E7%9B%AE%E5%BD%95'];
console.log(JSON.stringify(urls.map(url => ({ url, rules: passwordHeaderRules({ url }, 'own-id') }))));
"""
        cls.fixtures = json.loads(subprocess.check_output(
            ["node", "--input-type=module", "-e", script], cwd=ROOT, text=True))

    def test_140_combined_rule_exceeds_chromium_memory_limit(self):
        # Preserve the failing 1.4.0 expression to prove that ordinary JS RegExp
        # tests cannot catch this browser compiler regression.
        old = (
            r"^https://nas\.example:5443/qbt/api/v2/"
            r"(auth/login|app/defaultSavePath|app/getDirectoryContent\?dirPath=[^&#]*&mode=dirs|"
            r"torrents/(categories|add|delete|info\?(filter=(all|downloading|completed)"
            r"&sort=added_on&reverse=true&limit=51&offset=[0-9]+|hashes=[a-f0-9]+)))$"
        )
        with self.assertRaises(re2.error):
            compile_rule(old)

    def test_all_current_rules_fit_chromium_memory_limit(self):
        for fixture in self.fixtures:
            for rule in fixture["rules"]:
                with self.subTest(url=fixture["url"], rule=rule["id"]):
                    compile_rule(rule["condition"]["regexFilter"])

    def test_re2_matches_only_exact_endpoints_on_the_selected_base(self):
        allowed = [
            "auth/login", "app/defaultSavePath", "app/getDirectoryContent?dirPath=%2Fdata%2F&mode=dirs",
            "torrents/categories", "torrents/add", "torrents/delete",
            "torrents/info?hashes=" + "a" * 40, "torrents/info?hashes=" + "b" * 64,
            *["torrents/info?filter=" + state + "&sort=added_on&reverse=true&limit=51&offset=50"
              for state in ["all", "downloading", "completed"]],
        ]
        forbidden = ["app/shutdown", "auth/login?extra=true", "torrents/delete?hashes=all",
                     "torrents/info?hashes=all", "torrents/info?hashes=" + "a" * 40 + "%7C" + "b" * 40,
                     "app/getDirectoryContent?dirPath=%2F&mode=all"]
        for fixture in self.fixtures:
            compiled = [compile_rule(rule["condition"]["regexFilter"]) for rule in fixture["rules"]]
            base = fixture["url"].rstrip("/")
            for endpoint in allowed:
                url = (base + "/api/v2/" + endpoint).encode("ascii")
                with self.subTest(url=url):
                    self.assertEqual(sum(bool(rule.search(url)) for rule in compiled), 1)
            for url in [base + "/api/v2/" + endpoint for endpoint in forbidden] + [
                "https://other.example/api/v2/auth/login", base + "/extra/api/v2/auth/login"
            ]:
                with self.subTest(url=url):
                    self.assertFalse(any(rule.search(url.encode("ascii")) for rule in compiled))


if __name__ == "__main__":
    unittest.main()
