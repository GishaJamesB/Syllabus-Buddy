# Deploy to Firebase Hosting (owner, manual)

You run every step yourself. Nothing in this repo deploys or creates cloud resources. Do [firebase-setup.md](firebase-setup.md) first.

## 1. Install and link the project
1. `npm install -g firebase-tools`
2. `firebase login`
3. In this folder, run `firebase use --add`, pick your Firebase project and give it an alias (for example `default`). This writes `.firebaserc`. It is git-ignored on purpose, so your project ID stays on your machine and each person links their own project.

## 2. Check `.env.local`
1. Check that `.env.local` has every variable listed in `.env.example`.
2. Set `VITE_INFERENCE_MODE=prefer_on_device`.
3. Every `VITE_*` value is baked into the bundle when you build, so those values become public. Only put Firebase web config there, never a secret.
4. The App Check debug token is never read from env. The app turns debug mode on only under `npm run dev`, so a production build always uses reCAPTCHA Enterprise.

## 3. Allow the Hosting domains
1. Google Cloud Console, **Security, reCAPTCHA Enterprise**, open your key, and add both `<project>.web.app` and `<project>.firebaseapp.com` to its domains. Replace `<project>` with your project ID.
2. Firebase console, **Authentication, Settings, Authorized domains**. Check that both domains are listed. Firebase usually adds them by default.

## 4. Publish the Remote Config keys
The keys are optional, and the app uses safe defaults without them. The demo's mode flip needs them, so publish them now. Create these 6 keys from `src/config/tuning.ts`, as in [firebase-setup.md section 11](firebase-setup.md#11-tune-the-app-with-remote-config-optional), with these values:

| Key | Value |
|---|---|
| `max_turns` | 5 |
| `misses_before_help` | 3 |
| `test_seconds_easy` | 90 |
| `test_seconds_medium` | 120 |
| `test_seconds_hard` | 150 |
| `inference_mode` | `prefer_on_device` |

Click **Publish changes**. A published `inference_mode` overrides `VITE_INFERENCE_MODE`, so change the mode in the console, not in `.env.local`.

## 5. Build, preview and deploy
1. `npm run build`
2. Check the bundle has no dev-only code. This should print nothing:
   `grep -rliE "Author mode|Draft the lesson|I added 5 and 3|Structured-output test" dist`
3. `npm run preview` and open the printed URL. Check that `/author` shows the learner app and `/diagnostics` has no Run box. An App Check error on the preview is expected, because `localhost` is not on the reCAPTCHA key.
4. `firebase deploy --only hosting,firestore:rules`. This publishes the site and the Firestore security rules in `firestore.rules`. The Firestore database must already exist ([firebase-setup.md section 7](firebase-setup.md#7-create-the-cloud-firestore-database)).
5. The command prints the live URL, `https://<project>.web.app`.

## 6. Run the smoke test
Run the checklist below on the live URL. On `/diagnostics`, check that App Check shows no error and that the Tuning table shows `remote` for the keys you published.

## 7. Enforce App Check
Only after the smoke test passes, open Firebase console, **App Check, APIs**, and **Enforce** App Check for **Firebase AI Logic** and **Cloud Firestore**. Enforcement can take a few minutes to apply.

Then re-check a cloud call on the live URL: run the tutor (miss a question `misses_before_help` times), or run a Buddy turn in a profile without Nano. An on-device Buddy turn does not reach AI Logic, so it does not test enforcement.

Also check that a nickname still saves and reloads on the live URL. If Firestore calls are blocked, the app quietly falls back to browser storage, so check the console data (see the **Progress in Firestore** item below).

To roll back, set Firebase AI Logic and Cloud Firestore back to **Unenforced**.

## 8. Delete the debug token
When you no longer develop locally, open Firebase console, **App Check, Apps**, your web app, menu, **Manage debug tokens**. Delete the debug token.

## Smoke test

Run it in Chrome twice: once in a profile with Gemini Nano ready, and once in a profile or machine without Nano. The no-Nano pass expects `inference_mode` to be `prefer_on_device`, so Buddy falls back to the cloud. Every item should pass both times unless it says otherwise.

- [ ] **Load:** the live URL opens the start screen with no error.
- [ ] **Nickname:** add a nickname and start learning. Reload and check that the same nickname is still listed.
- [ ] **Progress in Firestore:** after adding a nickname and answering a question, reload and check the progress is still there. In the Firebase console, **Firestore Database, Data**, check the profile appears under `users/<uid>/profiles`.
- [ ] **Pass idea 1:** answer idea 1's check question correctly, and **Next** unlocks.
- [ ] **Buddy clue badge:** give a wrong answer. Buddy's clue shows 🔒 with Nano, or ☁️ without it.
- [ ] **No AI request on-device (Nano pass only):** open DevTools, **Network**, then give a wrong answer. Buddy's 🔒 clue appears and no request goes to the AI Logic endpoint (`firebasevertexai.googleapis.com`).
- [ ] **Read aloud:** click a speaker button and hear the idea read out.
- [ ] **Get on-device Buddy (Nano pass, before the model is downloaded):** the start screen offers **Get on-device Buddy**, and clicking it shows download progress.
- [ ] **Tutor:** miss the same question `misses_before_help` times (3 by default). The tutor card opens, shows the anonymised summary, lists its tool calls in "What the AI did" and ends with a correct answer or worked steps.
- [ ] **Test:** start a test, answer a few questions, finish it, and check that each wrong answer shows a correction.
- [ ] **Test history:** reload, pick the same nickname, and check the finished test is still in the history.
- [ ] **Grown-ups panel:** open **For grown-ups** and check the mistake summary shows.
- [ ] **Diagnostics:** `/diagnostics` shows sign-in, App Check, on-device status, inference mode and the Tuning table. There is no Run box.
- [ ] **Author:** `/author` shows the learner app, not author mode.
