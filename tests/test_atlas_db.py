#!/usr/bin/env python3
"""Tests for atlas-db.py core operations."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ATLAS = Path(__file__).resolve().parent.parent / "scripts" / "atlas-db.py"


def run_atlas(*args, stdin_data=None):
    """Run atlas-db.py with given args in a temp DB environment. Returns (returncode, stdout, stderr)."""
    env = os.environ.copy()
    result = subprocess.run(
        [sys.executable, str(ATLAS)] + list(args),
        capture_output=True, text=True, timeout=15,
        input=stdin_data, env=env
    )
    return result.returncode, result.stdout, result.stderr


class TestAtlasDB(unittest.TestCase):
    """Tests run against a temporary database to avoid touching the real one."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmpdir, "test.db")
        self.context_dir = os.path.join(self.tmpdir, "context")
        os.makedirs(self.context_dir, exist_ok=True)
        # Patch env so atlas-db.py uses our temp paths
        os.environ["ATLAS_DB_PATH"] = self.db_path
        os.environ["ATLAS_CONTEXT_DIR"] = self.context_dir

    def tearDown(self):
        import shutil
        os.environ.pop("ATLAS_DB_PATH", None)
        os.environ.pop("ATLAS_CONTEXT_DIR", None)
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_init_creates_db(self):
        rc, out, err = run_atlas("init")
        self.assertEqual(rc, 0)
        self.assertIn("initialized", out)
        self.assertTrue(os.path.exists(self.db_path))

    def test_commit_add_and_list(self):
        run_atlas("init")
        rc, out, err = run_atlas(
            "commit", "add",
            "--title", "Test task",
            "--direction", "mine",
            "--person", "Alice",
            "--category", "work",
            "--no-push"
        )
        self.assertEqual(rc, 0)
        data = json.loads(out)
        self.assertIn("task_id", data)
        task_id = data["task_id"]
        self.assertTrue(task_id.startswith("AI-"))

        # List and verify it appears
        rc, out, err = run_atlas("commit", "list", "--direction", "mine")
        self.assertEqual(rc, 0)
        items = json.loads(out)
        self.assertTrue(any(i["task_id"] == task_id for i in items))

    def test_commit_complete(self):
        run_atlas("init")
        rc, out, _ = run_atlas(
            "commit", "add",
            "--title", "Complete me",
            "--direction", "mine",
            "--no-push"
        )
        task_id = json.loads(out)["task_id"]

        rc, out, _ = run_atlas("commit", "complete", "--task-id", task_id, "--no-push")
        self.assertEqual(rc, 0)
        self.assertIn("completed", out)

        # Should not appear in active list
        rc, out, _ = run_atlas("commit", "list", "--direction", "mine", "--status", "active")
        items = json.loads(out)
        self.assertFalse(any(i["task_id"] == task_id for i in items))

    def test_commit_cancel(self):
        run_atlas("init")
        rc, out, _ = run_atlas(
            "commit", "add",
            "--title", "Cancel me",
            "--direction", "theirs",
            "--person", "Bob",
            "--no-push"
        )
        task_id = json.loads(out)["task_id"]

        rc, out, _ = run_atlas("commit", "cancel", "--task-id", task_id)
        self.assertEqual(rc, 0)
        self.assertIn("cancelled", out)

    def test_commit_search(self):
        run_atlas("init")
        run_atlas("commit", "add", "--title", "Review proposal from Heather",
                  "--direction", "mine", "--person", "Heather", "--no-push")
        run_atlas("commit", "add", "--title", "Send report to Bob",
                  "--direction", "mine", "--person", "Bob", "--no-push")

        rc, out, _ = run_atlas("commit", "search", "--query", "Heather")
        self.assertEqual(rc, 0)
        items = json.loads(out)
        self.assertEqual(len(items), 1)
        self.assertIn("Heather", items[0]["title"])

    def test_commit_overdue(self):
        run_atlas("init")
        run_atlas("commit", "add", "--title", "Overdue task",
                  "--direction", "mine", "--due", "2020-01-01", "--no-push")
        run_atlas("commit", "add", "--title", "Future task",
                  "--direction", "mine", "--due", "2099-12-31", "--no-push")

        rc, out, _ = run_atlas("commit", "overdue")
        self.assertEqual(rc, 0)
        items = json.loads(out)
        titles = [i["title"] for i in items]
        self.assertIn("Overdue task", titles)
        self.assertNotIn("Future task", titles)

    def test_commit_nudge(self):
        run_atlas("init")
        rc, out, _ = run_atlas(
            "commit", "add", "--title", "Waiting on reply",
            "--direction", "theirs", "--person", "Carol", "--no-push"
        )
        task_id = json.loads(out)["task_id"]

        rc, out, _ = run_atlas("commit", "nudge", "--task-id", task_id, "--channel", "email")
        self.assertEqual(rc, 0)
        self.assertIn("nudged", out)

    def test_dump_json_structure(self):
        run_atlas("init")
        run_atlas("commit", "add", "--title", "Dump test",
                  "--direction", "mine", "--no-push")

        rc, out, _ = run_atlas("dump")
        self.assertEqual(rc, 0)
        data = json.loads(out)
        self.assertIn("exported_at", data)
        self.assertIn("commitments", data)
        self.assertIn("meetings", data)
        self.assertIn("interactions", data)

    def test_render_generates_markdown(self):
        run_atlas("init")
        run_atlas("commit", "add", "--title", "Render test item",
                  "--direction", "mine", "--person", "Test", "--no-push")

        rc, out, _ = run_atlas("render")
        self.assertEqual(rc, 0)
        self.assertIn("rendered", out)

        ai_path = os.path.join(self.context_dir, "action-items.md")
        self.assertTrue(os.path.exists(ai_path))
        content = Path(ai_path).read_text()
        self.assertIn("Render test item", content)

    def test_interaction_log_and_list(self):
        run_atlas("init")
        rc, out, _ = run_atlas(
            "interaction", "log",
            "--person", "Alice",
            "--type", "email",
            "--direction", "outbound",
            "--summary", "Sent quarterly report"
        )
        self.assertEqual(rc, 0)
        data = json.loads(out)
        self.assertIn("person", data)
        self.assertEqual(data["person"], "Alice")

        rc, out, _ = run_atlas("interaction", "list", "--person", "Alice")
        self.assertEqual(rc, 0)
        items = json.loads(out)
        self.assertTrue(len(items) >= 1)
        self.assertEqual(items[0]["person"], "Alice")

    def test_complete_nonexistent_fails(self):
        run_atlas("init")
        rc, out, err = run_atlas("commit", "complete", "--task-id", "AI-00000000-000000")
        self.assertNotEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
