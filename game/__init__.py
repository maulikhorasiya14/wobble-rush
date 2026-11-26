"""Flask application factory."""
from __future__ import annotations

import os

from flask import Flask

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def create_app(config: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config["SAVE_PATH"] = os.path.join(PROJECT_ROOT, "data", "save.json")
    if config:
        app.config.update(config)

    from .routes import bp
    app.register_blueprint(bp)

    return app
