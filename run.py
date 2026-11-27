"""Start Wobble Rush, then open http://127.0.0.1:5000 in your browser.

Set WOBBLE_HOST=127.0.0.1 to keep the game on this computer only.
"""
import os
import webbrowser
from threading import Timer

from game import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("WOBBLE_PORT", "5000"))
    host = os.environ.get("WOBBLE_HOST", "0.0.0.0")
    url = f"http://127.0.0.1:{port}"
    # The reloader runs this file twice (a watcher and the real server);
    # only open the browser once.
    first_start = os.environ.get("WERKZEUG_RUN_MAIN") != "true"  # (only matters with the reloader)
    if first_start:
        print(f"Wobble Rush is running at {url}  (press Ctrl+C to stop)")
        if os.environ.get("WOBBLE_NO_BROWSER") != "1":
            Timer(1.5, lambda: webbrowser.open(url)).start()
    # The auto-reloader restarts the server whenever a game file changes, which
    # drops everyone in a multiplayer room, so it's off unless you ask for it
    # while editing the game (WOBBLE_RELOAD=1 python run.py).
    reload = os.environ.get("WOBBLE_RELOAD") == "1"
    app.run(host=host, port=port, debug=False, use_reloader=reload, threaded=True)
