# Google Sign-In (iOS)

The app uses the official **GoogleSignIn** iOS SDK (added to the exported Xcode project as a Swift
package by `Assets/Companion/Editor/IOSPostBuild.cs`). It signs in with two OAuth clients:

| Client (Google Cloud)   | Used as                          | Where it goes |
|-------------------------|----------------------------------|---------------|
| **iOS**                 | `GIDClientID` → token `azp`      | Unity `CompanionConfig.googleIosClientId`, web `GOOGLE_IOS_CLIENT_IDS` |
| **Web application**     | `GIDServerClientID` → token `aud`| Unity `CompanionConfig.googleServerClientId`, web `GOOGLE_CLIENT_IDS` |

The backend (`web/src/lib/identity.ts`) verifies the ID token signature, `iss`, `exp`, that `aud` is the
Web client and that `azp` is the iOS client, then keys the user by `sub`.

## One-time setup

1. **Bundle ID** — set a real identifier in Unity: *Project Settings → Player → iOS → Other Settings →
   Bundle Identifier* (the project still has the URP template default). The same value is
   `APPLE_BUNDLE_ID` in `web/.env.local` (Sign in with Apple audience).
2. **Google Cloud project** — <https://console.cloud.google.com/> → create/select a project →
   *Google Auth Platform* → configure **Branding** (app name, support email) and **Audience**
   (External; while in *Testing*, add your Google account as a test user).
3. **Web client** — *Clients → Create client → Web application* (name e.g. "Companion backend").
   No redirect URIs are needed. Copy the client ID.
4. **iOS client** — *Clients → Create client → iOS*, enter the bundle ID from step 1 (Team ID / App
   Store ID optional). Copy the client ID.
5. **Configure**
   - Unity: select `Assets/Companion/CompanionConfig.asset`, fill both client IDs, and set
     `apiBaseUrl` to an address the phone can reach (LAN IP of this PC or the Vercel URL).
   - Web: in `web/.env.local` set `GOOGLE_CLIENT_IDS=<web client id>` and
     `GOOGLE_IOS_CLIENT_IDS=<ios client id>`; restart `npm run dev`.
6. **Build** — *File → Build Profiles → iOS → Build*. The post-build step adds the GoogleSignIn
   package (10.x), `GIDClientID`, `GIDServerClientID` and the reversed-client-ID URL scheme.
   Open the Xcode project on a Mac (Xcode resolves the Swift package on first open), set your signing
   team, and run on a device.

## Verifying

- Tap **Continue with Google** on the sign-in screen → Google's sheet appears → after consent the app
  calls `POST /api/auth/google`; the web log should show `200`.
- A `401 invalid Google ID token` usually means the client IDs are swapped or `.env.local` was not
  reloaded.
