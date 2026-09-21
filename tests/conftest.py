import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Make the project root importable from test modules.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))


def pytest_configure(config):
    """Load .env.test for local runs. In CI the variables are already set,
    and the file is absent, so this is a no-op there."""
    env_test_path = Path(__file__).parent.parent / '.env.test'
    if env_test_path.exists():
        load_dotenv(env_test_path, override=True)
