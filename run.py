"""Start Wobble Rush locally, then open http://127.0.0.1:5000 in your browser."""
import os
import webbrowser
from threading import Timer

from game import create_app

app = create_app()

if __name__ == "__main__":
    url = "http://127.0.0.1:5000"
    if os.environ.get("WOBBLE_NO_BROWSER") != "1":
        Timer(1.0, lambda: webbrowser.open(url)).start()
    print(f"Wobble Rush is running at {url}  (press Ctrl+C to stop)")
    app.run(host="127.0.0.1", port=5000, debug=False)
