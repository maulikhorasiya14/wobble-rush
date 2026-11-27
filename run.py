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
    first_start = os.environ.get("WERKZEUG_RUN_MAIN") != "true"
    if first_start:
        print(f"Wobble Rush is running at {url}  (press Ctrl+C to stop)")
        if os.environ.get("WOBBLE_NO_BROWSER") != "1":
            Timer(1.5, lambda: webbrowser.open(url)).start()
    # use_reloader: restart automatically when game files change, so edits to
    # levels and settings take effect without stopping the server by hand.
    app.run(host=host, port=port, debug=False, use_reloader=True, threaded=True)
