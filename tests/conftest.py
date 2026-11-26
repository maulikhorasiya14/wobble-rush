import pytest

from game import create_app


@pytest.fixture
def save_path(tmp_path):
    return str(tmp_path / "save.json")


@pytest.fixture
def client(save_path):
    app = create_app({"TESTING": True, "SAVE_PATH": save_path})
    return app.test_client()
