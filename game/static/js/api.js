// Tiny wrapper around the Python server's JSON API.
async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  submitShow: (rounds) => request("POST", "/api/results", { rounds }),
};
