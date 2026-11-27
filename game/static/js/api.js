// Tiny wrapper around the Python server's JSON API.
async function request(method, path, body) {
  // Give up after a few seconds so the game never waits forever on the server.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new Error(err.name === "AbortError" ? "the game server didn't answer" : "can't reach the game server");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  levels: () => request("GET", "/api/levels"),
  profile: () => request("GET", "/api/profile"),
  saveProfile: (changes) => request("POST", "/api/profile", changes),
  tutorialDone: (time) => request("POST", "/api/profile/tutorial", { time }),
  resetProgress: () => request("POST", "/api/profile/reset", {}),
  newShow: (rounds) => request("POST", "/api/show", { rounds }),
  saveRound: (showId, index, time, qualified) => request("POST", "/api/round", { show_id: showId, index, time, qualified }),
  submitShow: (showId, rounds) => request("POST", "/api/results", { show_id: showId, rounds }),
};
