# Firebase setup (owner, manual)

You create every resource yourself. Nothing in this repo creates or changes Firebase resources.

## 1. Create the project
1. Open https://console.firebase.google.com and choose **Add project**.
2. Name it (for example `syllabus-buddy`). Google Analytics is not needed.

## 2. Register the web app
1. Project overview, **Add app**, choose Web (`</>`).
2. Give it a nickname. Skip Firebase Hosting for now.
3. Copy the `firebaseConfig` values; they go into `.env.local` (step 7).

## 3. Enable Firebase AI Logic with the Gemini Developer API
1. In the console open **Build, AI Logic**, then **Get started**.
2. Choose **Gemini Developer API** and accept the prompts (this creates a Gemini API key managed by Firebase; do not copy it into the app).

## 4. Create a reCAPTCHA Enterprise key
1. In Google Cloud Console (same project) open **Security, reCAPTCHA Enterprise**, and enable the API if asked.
2. **Create key**, platform **Website**, add your hosted domain (for example `<project-id>.web.app`). Do not add `localhost`; local development uses the debug token from step 8 instead.
3. Leave the checkbox challenge off so the key is score-based.
4. Copy the key ID; it is `VITE_RECAPTCHA_ENTERPRISE_KEY`.

## 5. Register the key in App Check
1. Firebase console, **Build, App Check**, **Apps** tab.
2. Choose your web app, **reCAPTCHA Enterprise**, paste the key ID, save.
3. Under **APIs**, enforce App Check for **Firebase AI Logic** (do this after step 8 works, so you are not locked out while testing).

## 6. Enable Anonymous Auth
Firebase console, **Build, Authentication, Sign-in method**, enable **Anonymous**.

## 7. Prepare `.env.local`
```
cp .env.example .env.local
```
Fill in the values from steps 2 and 4. Set `VITE_INFERENCE_MODE` to `prefer_on_device` (default), `only_on_device`, `only_in_cloud` or `prefer_in_cloud`.

## 8. Register the debug token
1. Run `npm install` then `npm run dev` and open the page with DevTools console open.
2. The Firebase SDK prints `App Check debug token: <uuid>`.
3. Firebase console, **App Check, Apps**, your web app, menu, **Manage debug tokens**, **Add debug token**, paste it.
4. Reload. The page should show an anonymous user ID with no App Check error. If it shows an App Check error, this step is the usual cause.

## 9. Enable Chrome's on-device model
1. Use desktop Chrome 139 or later.
2. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` (named `#prompt-api-for-gemini-nano` in some versions) and set it to **Enabled** (also enable `chrome://flags/#optimization-guide-on-device-model` set to **Enabled BypassPerfRequirement** if the model stays unavailable).
3. Relaunch Chrome. Check `chrome://on-device-internals` for model status.
4. On the spike page click **Prepare on-device model** to download it (needs a user click).

## 10. Run the checks
See the README for the three runtime checks and where to record the finding.
