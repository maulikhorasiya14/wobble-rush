def test_index_page(client):
    res = client.get("/")
    assert res.status_code == 200
    assert b"Wobble" in res.data and b"<canvas" in res.data


def test_static_scripts_served(client):
    for name in ("main", "world", "bots", "render", "render3d", "input", "api", "mp", "netsync", "hostworker"):
        assert client.get(f"/static/js/{name}.js").status_code == 200


def test_vendored_assets_served(client):
    """3D library and font ship with the game so it works offline."""
    assert client.get("/static/vendor/three/three.module.min.js").status_code == 200
    assert client.get("/static/vendor/fonts/fredoka-latin-600-normal.woff2").status_code == 200


def test_levels_endpoint(client):
    data = client.get("/api/levels").get_json()
    assert {"physics", "levels", "show", "palette", "bot_names"} <= data.keys()
    assert data["players"] == 12


def test_profile_update_and_validation(client):
    assert client.get("/api/profile").get_json()["tutorial_done"] is False
    res = client.post("/api/profile", json={"name": "  Ana   B ", "color": "#5b8cff"})
    assert res.get_json()["name"] == "Ana B"
    assert client.post("/api/profile", json={"color": "red"}).status_code == 400
    assert client.post("/api/profile", json={"name": "   "}).status_code == 400
    assert client.post("/api/profile", json={"name": 5}).status_code == 400
    assert client.get("/api/profile").get_json()["name"] == "Ana B"


def test_tutorial_marks_done(client):
    res = client.post("/api/profile/tutorial", json={"time": 41.5}).get_json()
    assert res["profile"]["tutorial_done"] is True and res["new_best"] is True
    assert client.post("/api/profile/tutorial", json={"time": 50}).get_json()["new_best"] is False
    assert client.post("/api/profile/tutorial", json={"time": "x"}).status_code == 400


def test_results_flow_and_reset(client):
    rounds = [
        {"level": "spin_sprint", "qualified": True, "time": 31.2, "place": 3},
        {"level": "tile_panic", "qualified": False, "time": 12.0, "place": 6},
    ]
    res = client.post("/api/results", json={"rounds": rounds})
    assert res.status_code == 200
    body = res.get_json()
    assert body["won"] is False and body["score"] > 0
    assert body["profile"]["stats"]["shows_played"] == 1
    assert client.get("/api/profile").get_json()["personal_best"]["best_score"] == body["score"]

    assert client.post("/api/results", json={"rounds": "nope"}).status_code == 400

    reset = client.post("/api/profile/reset").get_json()
    assert reset["stats"]["shows_played"] == 0


def test_random_show_and_results(client):
    assert client.post("/api/show", json={"rounds": 7}).status_code == 400
    show = client.post("/api/show", json={"rounds": 4}).get_json()
    assert len(show["rounds"]) == 4 and show["rounds"][-1]["qualify"] == 1
    first = show["rounds"][0]["level"]
    # A result that doesn't match the show is rejected.
    bad = [{"level": "nope", "qualified": False, "time": 10, "place": None}]
    assert client.post("/api/results", json={"show_id": show["show_id"], "rounds": bad}).status_code == 400
    ok = [{"level": first, "qualified": False, "time": 90, "place": None}]
    res = client.post("/api/results", json={"show_id": show["show_id"], "rounds": ok})
    assert res.status_code == 200 and res.get_json()["won"] is False
    # Each show can only be submitted once.
    assert client.post("/api/results", json={"show_id": show["show_id"], "rounds": ok}).status_code == 400
    assert client.post("/api/results", json={"show_id": "made-up", "rounds": ok}).status_code == 400


GUEST = {"REMOTE_ADDR": "192.168.1.7"}


def test_friends_on_the_network_get_their_own_save(client, save_path):
    client.post("/api/profile", json={"name": "Host"})
    res = client.get("/", environ_base=GUEST)
    assert "wobble_guest=" in res.headers.get("Set-Cookie", "")
    # The cookie is kept by the test client, so the guest keeps the same save file.
    assert client.get("/api/profile", environ_base=GUEST).get_json()["name"] == "Player"
    client.post("/api/profile", json={"name": "Friend"}, environ_base=GUEST)
    assert client.get("/api/profile", environ_base=GUEST).get_json()["name"] == "Friend"
    assert client.get("/api/profile").get_json()["name"] == "Host"


def test_tunnelled_requests_count_as_guests(client):
    client.post("/api/profile", json={"name": "Host"})
    proxied = client.get("/api/profile", headers={"X-Forwarded-For": "203.0.113.5"})
    assert proxied.get_json()["name"] == "Player"



def test_levels_include_multiplayer_options(client):
    mp = client.get("/api/levels").get_json()["multiplayer"]
    assert mp["max_players"] == 20 and mp["round_options"] == [1, 2, 3, 4, 5]


def test_round_bests_are_saved_straight_away(client):
    show = client.post("/api/show", json={"rounds": 3}).get_json()
    level = show["rounds"][0]["level"]
    res = client.post("/api/round", json={"show_id": show["show_id"], "index": 0, "time": 30.5, "qualified": True}).get_json()
    assert res["records"] and res["profile"]["personal_best"]["levels"][level]["best_time"] == 30.5
    # Quitting now still leaves the best on record.
    assert client.get("/api/profile").get_json()["personal_best"]["levels"][level]["best_time"] == 30.5
    assert client.post("/api/round", json={"show_id": "nope", "index": 0, "time": 1, "qualified": True}).status_code == 400
    assert client.post("/api/round", json={"show_id": show["show_id"], "index": 9, "time": 1, "qualified": True}).status_code == 400
