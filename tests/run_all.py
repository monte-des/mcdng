"""Runs every test script in this folder and reports which ones failed. Usage: python3 tests/run_all.py"""

import subprocess, sys
from pathlib import Path

failed = []
for test in sorted(Path(__file__).parent.glob("test_*.py")):
    print(f"== {test.name}", flush=True)
    result = subprocess.run([sys.executable, str(test)], timeout=300)
    if result.returncode:
        failed.append(test.name)
print("All tests passed." if not failed else f"Failed: {', '.join(failed)}")
sys.exit(1 if failed else 0)
