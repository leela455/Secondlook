// Where the SecondLook API lives.
//   ''                       -> same origin. Use this when the backend serves the frontend (open http://localhost:5000).
//   'http://localhost:5000'  -> use this when you serve the frontend from another port (e.g. `npx serve frontend -l 5173`).
//                               That origin must be listed in CLIENT_ORIGINS in backend/.env (5173, 3000 and 5500 already are).
window.SECONDLOOK_CONFIG = {
  API_BASE_URL: '',
};
