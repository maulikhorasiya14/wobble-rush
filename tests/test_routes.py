def test_index_page(client):
    res = client.get("/")
    assert res.status_code == 200
    assert b"Wobble" in res.data and b"<canvas" in res.data


def test_static_scripts_served(client):
    for name in ("main", "world", "bots", "render", "input", "api"):
        assert client.get(f"/static/js/{name}.js").status_code == 200


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
