# appyzeen-mcp

Build a signed Android APK or AAB from inside your AI editor.

You point it at an Android, Flutter or React Native project. It zips the project up, sends it
to the build server, runs Gradle there, signs the result with a release key, and hands back a
download link. You never install the Android SDK, the NDK, or a JDK.

I run the build service at [appyzeen.com](https://appyzeen.com). This repo is the small piece
that connects your editor to it.

## Why this package exists at all

The build server already speaks MCP over plain HTTP at `https://appyzeen.com/mcp`. If your
client can call a remote MCP server and attach an `Authorization` header, you don't need this
repo — use the URL directly and skip to [Tools](#tools).

Most clients can't. Cursor, Cline, Windsurf and a few others only launch a local command and
talk to it over stdin/stdout. So this is 100 lines that read JSON-RPC from stdin, POST it with
your key attached, and print the reply. That's the whole program. No dependencies.

## Setup

You need a key first. Sign in at [appyzeen.com](https://appyzeen.com), go to Settings, open the
API keys tab, create one. It starts with `apz_`.

Claude Desktop — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "appyzeen": {
      "command": "npx",
      "args": ["-y", "appyzeen-mcp"],
      "env": { "APPYZEEN_API_KEY": "apz_your_key_here" }
    }
  }
}
```

Claude Code:

```sh
claude mcp add appyzeen --env APPYZEEN_API_KEY=apz_your_key_here -- npx -y appyzeen-mcp
```

Cursor and Cline use the same shape as Claude Desktop, in their own settings file.

Restart the client. Ask it for your credits — if a number comes back, it's connected.

## Tools

**`get_credits`** — how many builds you have left.

**`create_project_upload`** — gives you a one-time URL to PUT your project zip to. Use this.
The obvious thing is to hand the files to the model directly, and that breaks on any real
project: a 40-file app is already too big for one message and gets silently truncated. The
upload id is a few characters.

**`build_android_app`** — the actual build. Needs `app_name` and `package_name`, plus the
`upload_id` from the step above. Everything else has a sensible default: `version_code` is the
last successful build of that package plus one, `version_name` follows from it, and you get
both an APK and an AAB unless you ask for one.

Three project types are detected automatically:

- Android Gradle — Java or Kotlin, C++ via the NDK too. Needs `settings.gradle` and an `app`
  module. The server's Gradle is used, not your `gradlew`.
- Flutter — `pubspec.yaml`, `lib/`, and the `android/` folder that `flutter create` makes.
- React Native — bare, or Expo after `expo prebuild`. Ship `android/gradlew` and
  `android/gradle/wrapper/` so your Gradle version is honoured, and `package-lock.json` so it
  can run `npm ci`.

Leave `node_modules`, `build/` and `.dart_tool` out of the zip.

**`get_build_status`** — phase, download URLs, and on failure the real Gradle output with
absolute paths and anything password-shaped stripped out. Also the signing certificate's
SHA-256, which is the thing to check before you push an update to Play.

**`publish_to_play`** — uploads the AAB to a Play track. The app has to exist in Play Console
already with its first release uploaded by hand, and you upload a service-account key to your
account once. `internal` and `closed` go live; `production` is created as a draft so you still
press the button yourself.

## Signing, because this is the part that bites people

The first build of a package generates a key and keeps it. Every later build of that same
package is signed with the same key, which is what Play demands for an update. Download the
keystore from My Apps and back it up — if you lose it and we lose it, that app can never be
updated again. Nobody can fix that, not Google either.

You can pass your own keystore instead. Passwords and key bytes don't appear in build logs or
in anything `get_build_status` returns.

`signing_mode` makes it explicit when you care: `reuse_existing` fails loudly rather than
quietly making a new key, `generate_new` always makes one and warns you if the package already
had one.

## Cost

One credit per successful build. Failed builds are free. Your first build on a new account is
free. Credits are bought at [appyzeen.com/pricing](https://appyzeen.com/pricing).

Retrying is safe. A repeat submission inside ten minutes returns the original build instead of
starting a second one, so a client timeout or an automatic retry can't charge you twice.
Editing a file makes it a genuinely new build.

## What this does not do

A successful build means the project compiled and the artifact was signed. Nothing installs it,
launches it, or runs it. Nothing checks Play Store policy. If the app crashes on open, the build
was still a success as far as this tool is concerned, and you'll find out on a device.

It also won't rescue a project that doesn't build locally. It isn't more forgiving than Gradle,
it's the same Gradle on someone else's machine.

## Environment variables

| | |
|---|---|
| `APPYZEEN_API_KEY` | required, your `apz_...` key |
| `APPYZEEN_MCP_URL` | defaults to `https://appyzeen.com/mcp`, only useful for testing |
| `APPYZEEN_MCP_TIMEOUT_MS` | defaults to 120000 |

## Running the tests

```sh
npm test
```

Four tests. They stand up a throwaway HTTP server and run the real bridge against it: that the
key gets attached, that a notification gets no reply, that an HTML error page from a proxy comes
back as a JSON-RPC error instead of crashing the client, and that a missing key exits with a
message a human can act on. No network, no mocks.

## License

MIT.
